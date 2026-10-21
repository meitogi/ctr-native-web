// OnlineCTR server core.
//
// Port of CTR-ModSDK e3f19686 mods/Windows/OnlineCTR/Network_PC/Server/SV_main.c
// and SV_helper.c (GPL-3.0), without ENet, clock() or stdout. Handlers keep
// upstream's order and names. Differences, all on paths a well-formed
// client never takes or on upstream bugs:
// - packets are parsed from a zero-padded copy (no read past a short packet);
// - CG_JOINROOM rejects room 16 (upstream indexes roomInfos[16]);
// - a peer leaving from the room list is removed from the room-list peers
//   (upstream keeps it until its ENet slot is reused);
// - the 6 s room reset is wall time (upstream: CPU time).
// docs/ONLINECTR_PORT.md, D4.

#include <stddef.h>
#include <string.h>

#define WINDOWS_INCLUDE
#include "../../game/OnlineCTR/global.h"

#include "sv_core.h"

#define MAX_CLIENTS 8
#define NUM_ROOMS 16
#define ROOM_RESET_MS 6000
#define SV_CORE_MAX_PACKET 16

typedef struct {
	// peerId + 1, 0 = empty slot (upstream: ENetPeer*)
	int peer;

	char name[NAME_LEN];
	char characterID;
	char boolLoadSelf;
	char boolRaceSelf;
	char boolEndSelf;
} PeerInfo;

typedef struct
{
	PeerInfo peerInfos[MAX_CLIENTS];

	unsigned char clientCount;
	unsigned char levelPlayed;
	unsigned char padding[2];

	char boolRoomLocked;
	char boolLoadAll;
	char boolRaceAll;
	char boolEndAll;

	unsigned int endTime;

} RoomInfo;

static SvCoreHost sv;
static RoomInfo roomInfos[NUM_ROOMS];

static struct
{
	char connected;
	unsigned long long addressKey;
} peers[SV_CORE_MAX_PEERS];

// room-list peers, in connection order (upstream: LoosePeerList)
static int lpl[SV_CORE_MAX_PEERS];
static int lplCount;

static unsigned int nowTick;

#define SV_LOG(...) do { if (sv.log) sv.log(__VA_ARGS__); } while (0)

static int RoomIndex(const RoomInfo *ri)
{
	return (int)(ri - &roomInfos[0]);
}

static int PeerConnected(int peer)
{
	return peer != 0 && peers[peer - 1].connected;
}

static void AddPeerLPL(int peerId)
{
	lpl[lplCount++] = peerId;
}

static int RemovePeerLPL(int peerId)
{
	int didFree = 0;
	int j = 0;

	for (int i = 0; i < lplCount; i++)
	{
		if (lpl[i] == peerId)
		{
			didFree = 1;
			continue;
		}
		lpl[j++] = lpl[i];
	}
	lplCount = j;
	return didFree;
}

static void ForeachPeerLPL(void (*lambda)(int))
{
	for (int i = 0; i < lplCount; i++)
		lambda(lpl[i]);
}

static void SendToPeer(int peerId, const void *data, int size, int reliable)
{
	if (peers[peerId].connected)
		sv.send(peerId, data, size, reliable);
}

// similar to enet_host_broadcast
static void broadcastToPeersUnreliable(RoomInfo *ri, const void *data, int size)
{
	for (int i = 0; i < MAX_CLIENTS; i++)
		if (PeerConnected(ri->peerInfos[i].peer))
			sv.send(ri->peerInfos[i].peer - 1, data, size, 0);
}

// similar to enet_host_broadcast
static void broadcastToPeersReliable(RoomInfo *ri, const void *data, int size)
{
	for (int i = 0; i < MAX_CLIENTS; i++)
		if (PeerConnected(ri->peerInfos[i].peer))
			sv.send(ri->peerInfos[i].peer - 1, data, size, 1);
}

static void SetTimeout(int peerId, int ms)
{
	if (sv.setTimeout)
		sv.setTimeout(peerId, ms);
}

static void Kick(int peerId)
{
	peers[peerId].connected = 0;
	RemovePeerLPL(peerId);
	sv.kick(peerId);
}

static void SendRoomData(int peerId)
{
	struct SG_MessageRooms mr = {0};
	mr.type = SG_ROOMS;
	mr.numRooms = 16;
	mr.version = VERSION;

// Turn 1-7 inro 9-15
#define SETUP(x, index) \
	x = roomCount[index]; \
	if (roomInfos[index].boolRoomLocked) \
		if(x < 8) \
			x += 8;

	// Do NOT use roomInfos[index].clientCount,
	// cause that doesnt account for empty holes

	int roomCount[16];
	memset(&roomCount[0], 0, sizeof(roomCount));

	for(int i = 0; i < 16; i++)
		for(int j = 0; j < 8; j++)
			if (roomInfos[i].peerInfos[j].peer != 0)
				roomCount[i]++;

	// required for bit packing :4
	SETUP(mr.numClients01, 0x0);
	SETUP(mr.numClients02, 0x1);
	SETUP(mr.numClients03, 0x2);
	SETUP(mr.numClients04, 0x3);
	SETUP(mr.numClients05, 0x4);
	SETUP(mr.numClients06, 0x5);
	SETUP(mr.numClients07, 0x6);
	SETUP(mr.numClients08, 0x7);
	SETUP(mr.numClients09, 0x8);
	SETUP(mr.numClients10, 0x9);
	SETUP(mr.numClients11, 0xa);
	SETUP(mr.numClients12, 0xb);
	SETUP(mr.numClients13, 0xc);
	SETUP(mr.numClients14, 0xd);
	SETUP(mr.numClients15, 0xe);
	SETUP(mr.numClients16, 0xf);

#undef SETUP

	SendToPeer(peerId, &mr, sizeof(struct SG_MessageRooms), 1);
}

static void GetDriverFromRace(int peerId, RoomInfo **ri, int *slot)
{
	for (int r = 0; r < NUM_ROOMS; r++)
	{
		*ri = &roomInfos[r];

		for (int i = 0; i < MAX_CLIENTS; i++)
			if ((*ri)->peerInfos[i].peer == peerId + 1)
				*slot = i;

		if (*slot != -1)
			break;
	}
}

void SvCore_Init(const SvCoreHost *host)
{
	sv = *host;
	memset(roomInfos, 0, sizeof(roomInfos));
	memset(peers, 0, sizeof(peers));
	lplCount = 0;
}

void SvCore_Connect(int peerId, unsigned long long addressKey)
{
	if (peerId < 0 || peerId >= SV_CORE_MAX_PEERS)
		return;

	peers[peerId].connected = 1;
	peers[peerId].addressKey = addressKey;

	AddPeerLPL(peerId);

	SendRoomData(peerId);

	// Set the timeout settings for the host
	SetTimeout(peerId, 2000);
}

void SvCore_Disconnect(int peerId)
{
	//identify which client ID this came from
	int slot = -1;
	int numAlive = 0;

	if (peerId < 0 || peerId >= SV_CORE_MAX_PEERS || !peers[peerId].connected)
		return;

	peers[peerId].connected = 0;

	RoomInfo *ri = &roomInfos[0];

	//identify which client ID this came from
	GetDriverFromRace(peerId, &ri, &slot);

	// driver is not in a room, just quit
	if (slot == -1)
	{
		RemovePeerLPL(peerId);
		return;
	}

	for (int i = 0; i < MAX_CLIENTS; i++)
		if (ri->peerInfos[i].peer != 0)
			numAlive++;

	// subtract one, cause one of the peers was still
	// alive in the for-loop that is about to be nullified
	numAlive -= 1;

	RemovePeerLPL(peerId);
	SV_LOG("[Room %d] Player %.*s (%d) disconnected from room\n",
		RoomIndex(ri) + 1, NAME_LEN, &ri->peerInfos[slot].name[0], slot);

	// no players are left
	int noneAlive = numAlive == 0;
	//race is in session and (1 or less players AND non-race map)
	int oneOrLessOrNonRaceMap = (ri->boolRaceAll == 1) && ((numAlive <= 1) && (ri->levelPlayed > 18));
	// Kill lobby under either of these conditions
	int killLobby = noneAlive || oneOrLessOrNonRaceMap;
	if (killLobby)
	{
		SV_LOG("[Room %d] Room has been killed\n", RoomIndex(ri) + 1);

		for (int i = 0; i < MAX_CLIENTS; i++)
		{
			int peer = ri->peerInfos[i].peer;

			if (peer == 0 || peer == peerId + 1)
				continue;

			if (peers[peer - 1].connected)
				Kick(peer - 1);
		}

		memset(ri, 0, sizeof(RoomInfo));
	}
	// Only disconnect one player as long as
	// more racers remain on Arcade track,
	// or if disconnected from Battle/Adv during the race
	else
	{
		ri->peerInfos[slot].peer = 0;

		// if this client ended race, dont tell
		// anyone that the client disconnected
		if (ri->peerInfos[slot].boolEndSelf != 0)
			return;

		// dont block gameplay for everyone else
		ri->peerInfos[slot].boolLoadSelf = 1;
		ri->peerInfos[slot].boolRaceSelf = 1;

		struct SG_MessageName sgBuffer = {0};
		struct SG_MessageName *s = &sgBuffer;

		// send NULL name to all OTHER clients
		s->type = SG_NAME;
		s->clientID = slot;
		s->numClientsTotal = ri->clientCount;
		memset(&s->name[0], 0, sizeof(s->name));

		broadcastToPeersReliable(ri, s, sizeof(struct SG_MessageName));

		// host (slot 0) leaving: no re-election upstream either
	}

	ForeachPeerLPL(SendRoomData); //someone left a room, notify everyone else.
}

static void WelcomeNewClient(RoomInfo *ri, int id)
{
	// Send acceptance to client
	struct SG_MessageClientStatus mw = {0};
	mw.type = SG_NEWCLIENT;
	mw.clientID = id;
	mw.numClientsTotal = ri->clientCount;

	// ordinary day
	mw.special = 0;

	SendToPeer(ri->peerInfos[id].peer - 1, &mw, sizeof(struct SG_MessageClientStatus), 1);
}

void SvCore_Receive(int peerId, const void *buf, int len)
{
	int peerID = -1;

	RoomInfo *ri = &roomInfos[0];

	// zero-padded copy: a short packet never reads past its end
	unsigned char recvBuf[SV_CORE_MAX_PACKET] = {0};
	char sgBuffer[16];
	memset(sgBuffer, 0, sizeof(sgBuffer));

	if (peerId < 0 || peerId >= SV_CORE_MAX_PEERS || !peers[peerId].connected || len <= 0)
		return;

	memcpy(recvBuf, buf, len < SV_CORE_MAX_PACKET ? len : SV_CORE_MAX_PACKET);

	//identify which client ID this came from
	GetDriverFromRace(peerId, &ri, &peerID);

	if (((struct CG_Header *)recvBuf)->type != CG_JOINROOM)
	{
		if (peerID == -1)
			return;
	}

	// switch will compile into a jmp table, no funcPtrs needed
	switch (((struct CG_Header *)recvBuf)->type)
	{
		case CG_JOINROOM:
		{
			struct CG_MessageRoom *r = (struct CG_MessageRoom *)recvBuf;

			// kick if room is invalid
			if (r->room >= NUM_ROOMS)
			{
				// update data, reject player
				SendRoomData(peerId);
				return;
			}

			ri = &roomInfos[r->room];

			// kick if room is locked
			if (ri->boolRoomLocked)
			{
				// update data, reject player
				SendRoomData(peerId);
				return;
			}

			// look for empty slot
			int id = -1;
			for (int i = 0; i < MAX_CLIENTS; i++)
				if (ri->peerInfos[i].peer == 0)
				{
					id = i;
					break;
				}

			// Full room
			if (id == -1)
			{
				// update data, reject player
				SendRoomData(peerId);
				return;
			}

			// Avoid duplicate connection (from multiple CG_Room messages)
			for (int i = 0; i < MAX_CLIENTS; i++)
			{
				int peer = ri->peerInfos[i].peer;

				// Peer is valid, matches IP and port of another in the room
				if (peer != 0 && peers[peer - 1].addressKey == peers[peerId].addressKey)
				{
					// cancel duplicate connection
					return;
				}
			}

			// === Connection Accepted ===

			// if added to end, then increase count
			if (id == ri->clientCount)
				ri->clientCount++;

			// If a client disconnects, bools are set to 1,
			// so now if you leave and rejoin, this resets to 0
			memset(&ri->peerInfos[id], 0, sizeof(PeerInfo));

			ri->peerInfos[id].peer = peerId + 1;

			ForeachPeerLPL(SendRoomData); //someone chose a room, notify everyone else.

			// 5 seconds
			SetTimeout(peerId, 5000);

			WelcomeNewClient(ri, id);

			break;
		}

		case CG_NAME:
		{
			struct SG_MessageName *s = (struct SG_MessageName *)&sgBuffer[0];
			struct CG_MessageName *r = (struct CG_MessageName *)recvBuf;

			s->numClientsTotal = ri->clientCount;

			// save new name
			memcpy(&ri->peerInfos[peerID].name[0], &r->name[0], NAME_LEN);

			SV_LOG("[Room %d] Player %d joined room %d and is now identified as %.*s\n",
				RoomIndex(ri) + 1, peerID, RoomIndex(ri) + 1, NAME_LEN, r->name);

			s->type = SG_NAME;

			// send all OTHER (8) names to THIS (1) client
			for (int j = 0; j < MAX_CLIENTS; j++)
			{
				if (
						// skip empty sockets, skip self
						(ri->peerInfos[j].peer != 0) &&
						(peerID != j)
					)
				{
					// send all OTHER (8) names to THIS (1) client
					s->clientID = j;
					memcpy(&s->name[0], &ri->peerInfos[j].name[0], NAME_LEN);
					SendToPeer(peerId, s, sizeof(struct SG_MessageName), 1);
				}
			}

			// send THIS (1) name to all OTHER (8) clients
			s->clientID = peerID;
			memcpy(&s->name[0], &ri->peerInfos[peerID].name[0], NAME_LEN);
			broadcastToPeersReliable(ri, s, sizeof(struct SG_MessageName));
			break;
		}

		case CG_TRACK:
		{
			// clients can only connect during track selection,
			// once the Client Gives CG_TRACK to server, close it
			ri->boolRoomLocked = 1;

			struct SG_MessageTrack *s = (struct SG_MessageTrack *)&sgBuffer[0];
			struct CG_MessageTrack *r = (struct CG_MessageTrack *)recvBuf;

			s->type = SG_TRACK;
			s->trackID = r->trackID;
			s->lapID = r->lapID;

			ri->levelPlayed = s->trackID;

			SV_LOG("[Room %d] Track #%d and %d laps were selected\n",
				RoomIndex(ri) + 1, s->trackID, (2*s->lapID)+1);

			broadcastToPeersReliable(ri, s, sizeof(struct CG_MessageTrack));

			ForeachPeerLPL(SendRoomData);

			break;
		}

		case CG_CHARACTER:
		{
			struct SG_MessageCharacter *s = (struct SG_MessageCharacter *)&sgBuffer[0];
			struct CG_MessageCharacter *r = (struct CG_MessageCharacter *)recvBuf;

			s->type = SG_CHARACTER;
			s->clientID = peerID;
			s->characterID = r->characterID;
			s->boolLockedIn = r->boolLockedIn;

			ri->peerInfos[peerID].characterID = s->characterID;
			ri->peerInfos[peerID].boolLoadSelf = s->boolLockedIn;

			broadcastToPeersReliable(ri, s, sizeof(struct SG_MessageCharacter));
			break;
		}

		case CG_STARTRACE:
		{
			ri->peerInfos[peerID].boolRaceSelf = 1;
			break;
		}

		case CG_RACEDATA:
		{
			struct SG_EverythingKart *s = (struct SG_EverythingKart *)&sgBuffer[0];
			struct CG_EverythingKart *r = (struct CG_EverythingKart *)recvBuf;

			s->type = SG_RACEDATA;
			s->clientID = peerID;

			s->kartRot1 = r->kartRot1;
			s->kartRot2 = r->kartRot2;

			s->buttonHold = r->buttonHold;

			s->boolReserves = r->boolReserves;
			s->wumpa = r->wumpa;

			memcpy(&s->posX, &r->posX, 6);

			broadcastToPeersUnreliable(ri, s, sizeof(struct SG_EverythingKart));
			break;
		}

		case CG_WEAPON:
		{
			struct SG_MessageWeapon *s = (struct SG_MessageWeapon *)&sgBuffer[0];
			struct CG_MessageWeapon *r = (struct CG_MessageWeapon *)recvBuf;

			s->type = SG_WEAPON;
			s->clientID = peerID;

			s->weapon = r->weapon;
			s->juiced = r->juiced;
			s->flags = r->flags;

			// potential cheat mitigation, as upstream: weapons in item rooms only
			int rn = RoomIndex(ri);
			if (ROOM_IS_ITEMS(rn))
				broadcastToPeersReliable(ri, s, sizeof(struct SG_MessageWeapon));

			break;
		}

		case CG_ENDRACE:
		{
			struct SG_MessageEndRace *s = (struct SG_MessageEndRace *)&sgBuffer[0];
			struct CG_MessageEndRace *r = (struct CG_MessageEndRace *)recvBuf;

			s->type = SG_ENDRACE;
			s->clientID = peerID;

			memcpy(&s->courseTime, &r->courseTime, sizeof(r->courseTime));
			memcpy(&s->lapTime, &r->lapTime, sizeof(r->lapTime));

			ri->peerInfos[peerID].boolEndSelf = 1;

			broadcastToPeersReliable(ri, s, sizeof(struct SG_MessageEndRace));
			break;
		}

		default:
		{
			break;
		}
	}
}

void SvCore_Tick(unsigned int nowMs)
{
	nowTick = nowMs;

	for (int r = 0; r < NUM_ROOMS; r++)
	{
		RoomInfo *ri = &roomInfos[r];

		if (ri->clientCount == 0)
			continue;

		if (!ri->boolLoadAll)
		{
			ri->boolLoadAll = 1;
			for (int j = 0; j < ri->clientCount; j++)
				if (ri->peerInfos[j].peer != 0)
					if (ri->peerInfos[j].boolLoadSelf == 0)
						ri->boolLoadAll = 0;

			if (ri->boolLoadAll)
			{
				// send to all clients
				struct SG_Header sg = {0};
				sg.type = SG_STARTLOADING;
				broadcastToPeersReliable(ri, &sg, sizeof(struct SG_Header));
			}
		}

		if (!ri->boolRaceAll)
		{
			ri->boolRaceAll = 1;
			for (int j = 0; j < ri->clientCount; j++)
				if (ri->peerInfos[j].peer != 0)
					if (ri->peerInfos[j].boolRaceSelf == 0)
						ri->boolRaceAll = 0;

			if (ri->boolRaceAll)
			{
				// send to all clients
				struct SG_Header sg = {0};
				sg.type = SG_STARTRACE;
				broadcastToPeersReliable(ri, &sg, sizeof(struct SG_Header));
			}
		}

		if (!ri->boolEndAll)
		{
			ri->boolEndAll = 1;
			for (int j = 0; j < ri->clientCount; j++)
				if (ri->peerInfos[j].peer != 0)
					if (ri->peerInfos[j].boolEndSelf == 0)
						ri->boolEndAll = 0;

			if (ri->boolEndAll)
			{
				SV_LOG("[Room %d] Race has terminated, resetting room soon\n", r + 1);
				ri->endTime = nowTick;
			}
		}

		else
		{
			if ((nowTick - ri->endTime) >= ROOM_RESET_MS)
			{
				SV_LOG("[Room %d] Room has been reset\n", r + 1);

				for (int i = 0; i < MAX_CLIENTS; i++)
				{
					if (ri->peerInfos[i].peer == 0)
						continue;

					ri->peerInfos[i].boolLoadSelf = 0;
					ri->peerInfos[i].boolRaceSelf = 0;
					ri->peerInfos[i].boolEndSelf = 0;

					// tell all clients to reset
					WelcomeNewClient(ri, i);
				}

				ri->levelPlayed = 0;
				ri->boolRoomLocked = 0;
				ri->boolLoadAll = 0;
				ri->boolRaceAll = 0;
				ri->boolEndAll = 0;
				ri->endTime = 0;

				ForeachPeerLPL(SendRoomData); //race over, re-notify all clients
			}
		}
	}
}
