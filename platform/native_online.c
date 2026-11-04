// OnlineCTR client, in-process.
//
// Port of CTR-ModSDK e3f19686 mods/Windows/OnlineCTR/Network_PC/Client/CL_main.cpp
// (GPL-3.0). The state handlers, ProcessReceiveEvent, SendEverything and
// DisconSELECT keep upstream's order and names. What changed:
// - every pBuf[0x8...] access is a named game field (native_online_game.h);
// - ENet is behind OnlineTransport (native_online_transport.h);
// - console prompts are replaced by NativeOnline_Configure();
// - the connection is asynchronous: the game frame never blocks;
// - the loop body runs once per game frame from NativeOnline_Frame()
//   instead of after FrameStall().
// See docs/ONLINECTR_PORT.md, D3.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define WINDOWS_INCLUDE
#include "../game/OnlineCTR/global.h"

#include "native_online.h"
#include "native_online_game.h"

#define NATIVE_ONLINE_MAX_PACKET 64
#define NATIVE_ONLINE_CONNECT_TIMEOUT_MS 3000
#define NATIVE_ONLINE_CONNECT_RETRIES 3

static struct OnlineCTR *octr;
static const OnlineTransport *transport;

static int buttonPrev[8];
static char name[NAME_LEN + 1] = "Player";
static char privateServer[64] = "127.0.0.1:64001";

static int boolConnected;
static int boolConnecting;
static int connectRetry;
static unsigned int connectStartMs;
static char connectAddress[64];

static unsigned int frameCount;
static int lastLoggedState = -100;

static int (*controlPoll)(int *arg);
static int pendingEnter;
static const NativeOnlineBotHooks *botHooks;

// Session 32 : the host left mid-race, this guest finishes the race alone — its
// own AI drives every other kart, the results end as the room's would, then the
// title. soloEndAt : the race clock when the full results have shown long
// enough (the server's ROOM_RESET_MS), 0 until they are complete.
#define SOLO_RESULTS_MS 6000
static int soloRace;
static int soloEndAt;

// a slot the host's own AI drives (D11.2) : its echoed kart states and weapons are not applied
static int HostBot(int slot)
{
	return (*NativeOnlineGame_HostBots() >> slot) & 1;
}

#if defined(__EMSCRIPTEN__) && !defined(NDEBUG)
void (*NativeOnline_DebugRaceData)(int slot, int posX, int posY, int posZ);
#endif

static void sendToHostUnreliable(const void *data, int size)
{
	if (boolConnected)
		transport->send(data, size, 0);
}

static void sendToHostReliable(const void *data, int size)
{
	if (boolConnected)
		transport->send(data, size, 1);
}

static void ClientSlotPad(int slot, int held)
{
	// make this player hold SQUARE (held = 0x20)
	NativeOnlineGame_SetPad(slot, held, 0, 0, held);
}

// 11b smoothing (ctr-native, not upstream) : upstream writes each SG_RACEDATA pose
// straight into the remote kart. The pose is a few ms old and the kart has driven on
// with the received pad meanwhile (vehThread.c), so a varying delay snaps it back and
// forth every frame (session 11 measured ~100-unit jolts under jitter). Here the
// difference between the received pose and the kart is closed over a few frames : the
// errors of one frame's packets are averaged, SMOOTH_DIV-th of what is left is applied
// each frame, a difference past SMOOTH_SNAP (a respawn, a mask grab) is still a snap.
// Nothing changes on the wire.
#define SMOOTH_SNAP (512 * 256)   // posCurr units : 512 world units, ~8 frames at top speed
#define SMOOTH_SNAP_ANGLE 1024    // a quarter turn, of 4096
#define SMOOTH_DIV 12             // measured : 4 and 8 left jitter jerk p95 at ~25 / ~10, 12 at ~6 (session 11b)

static struct
{
	int sumX, sumY, sumZ, sumAngle, count; // this frame's packets, as errors
	int errX, errY, errZ, errAngle;        // still to apply
} smooth[8];

static int WrapAngle(int a)
{
	return ((a + 2048) & 0xfff) - 2048;
}

static void SmoothReset(void)
{
	memset(smooth, 0, sizeof(smooth));
}

static void SmoothReceive(int slot, int posX, int posY, int posZ, int angle)
{
	struct NativeOnlineKart kart;
	int dx, dy, dz, da;

	if (!NativeOnlineGame_GetKart(slot, &kart))
		return;

	dx = posX - kart.posX;
	dy = posY - kart.posY;
	dz = posZ - kart.posZ;
	da = WrapAngle(angle - kart.angle);

	if ((dx > SMOOTH_SNAP) || (dx < -SMOOTH_SNAP) || (dy > SMOOTH_SNAP) || (dy < -SMOOTH_SNAP) ||
		(dz > SMOOTH_SNAP) || (dz < -SMOOTH_SNAP) || (da > SMOOTH_SNAP_ANGLE) || (da < -SMOOTH_SNAP_ANGLE))
	{
		memset(&smooth[slot], 0, sizeof(smooth[slot]));
		NativeOnlineGame_SetKartPose(slot, posX, posY, posZ, angle);
		return;
	}

	smooth[slot].sumX += dx;
	smooth[slot].sumY += dy;
	smooth[slot].sumZ += dz;
	smooth[slot].sumAngle += da;
	smooth[slot].count++;
}

// One step towards each remote kart's received pose, once per bridge frame.
static int SmoothStep(int *err)
{
	int step = *err / SMOOTH_DIV;

	// the last bit at once, so the error does not linger at a few units
	if ((step == 0) || ((*err < 256) && (*err > -256)))
		step = *err;
	*err -= step;
	return step;
}

static void SmoothFrame(void)
{
	struct NativeOnlineKart kart;

	if ((octr->CurrState < GAME_WAIT_FOR_RACE) || (NativeOnlineGame_LoadingStage() != -1))
	{
		SmoothReset();
		return;
	}

	for (int slot = 1; slot < 8; slot++)
	{
		if (smooth[slot].count)
		{
			// a newer measure of the same difference replaces what was left of the older one
			int n = smooth[slot].count;
			smooth[slot].errX = smooth[slot].sumX / n;
			smooth[slot].errY = smooth[slot].sumY / n;
			smooth[slot].errZ = smooth[slot].sumZ / n;
			smooth[slot].errAngle = smooth[slot].sumAngle / n;
			smooth[slot].sumX = smooth[slot].sumY = smooth[slot].sumZ = smooth[slot].sumAngle = 0;
			smooth[slot].count = 0;
		}

		if (!(smooth[slot].errX | smooth[slot].errY | smooth[slot].errZ | smooth[slot].errAngle))
			continue;

		if (!NativeOnlineGame_GetKart(slot, &kart))
		{
			memset(&smooth[slot], 0, sizeof(smooth[slot]));
			continue;
		}

		{
			int sx = SmoothStep(&smooth[slot].errX);
			int sy = SmoothStep(&smooth[slot].errY);
			int sz = SmoothStep(&smooth[slot].errZ);
			int sa = smooth[slot].errAngle / SMOOTH_DIV;

			if ((sa == 0) || ((smooth[slot].errAngle < 8) && (smooth[slot].errAngle > -8)))
				sa = smooth[slot].errAngle;
			smooth[slot].errAngle -= sa;

			NativeOnlineGame_SetKartPose(slot, kart.posX + sx, kart.posY + sy, kart.posZ + sz, (kart.angle + sa) & 0xfff);
		}
	}
}

static void ProcessReceiveEvent(void *packet, int len)
{
	// zero-padded copy: a short packet never reads past its end
	unsigned char buf[NATIVE_ONLINE_MAX_PACKET] = {0};
	struct SG_Header *recvBuf = (struct SG_Header *)buf;
	int slot = 0;

	if (len > NATIVE_ONLINE_MAX_PACKET)
		len = NATIVE_ONLINE_MAX_PACKET;
	memcpy(buf, packet, len);

	switch (recvBuf->type)
	{
		case SG_ROOMS:
		{
			struct SG_MessageRooms *r = (struct SG_MessageRooms *)recvBuf;

			octr->ver_pc = VERSION;
			octr->ver_server = r->version;

			if (!(r->version == 1019 && VERSION == 1020) && !(r->version == 1019 && VERSION == 1021) && !(r->version == 1020 && VERSION == 1021)) //special case, certain servers are compatible with certain other client versions.
				if (r->version != VERSION)
				{
					octr->CurrState = LAUNCH_ERROR;
					return;
				}

			if (octr->ver_psx != VERSION)
			{
				octr->CurrState = LAUNCH_ERROR;
				return;
			}

			// reopen the room menu,
			// either first time getting rooms,
			// or refresh after joining refused
			octr->serverLockIn2 = 0;

			octr->numRooms = r->numRooms;

			octr->clientCount[0x0] = r->numClients01;
			octr->clientCount[0x1] = r->numClients02;
			octr->clientCount[0x2] = r->numClients03;
			octr->clientCount[0x3] = r->numClients04;
			octr->clientCount[0x4] = r->numClients05;
			octr->clientCount[0x5] = r->numClients06;
			octr->clientCount[0x6] = r->numClients07;
			octr->clientCount[0x7] = r->numClients08;
			octr->clientCount[0x8] = r->numClients09;
			octr->clientCount[0x9] = r->numClients10;
			octr->clientCount[0xa] = r->numClients11;
			octr->clientCount[0xb] = r->numClients12;
			octr->clientCount[0xc] = r->numClients13;
			octr->clientCount[0xd] = r->numClients14;
			octr->clientCount[0xe] = r->numClients15;
			octr->clientCount[0xf] = r->numClients16;

			break;
		}

		// Assigned to room
		case SG_NEWCLIENT:
		{
			struct SG_MessageClientStatus *r = (struct SG_MessageClientStatus *)recvBuf;

			octr->DriverID = r->clientID;
			octr->NumDrivers = r->numClientsTotal;

			// default, disable cheats ; turbo pads in retro rooms
			int rn = octr->serverRoom;
			NativeOnlineGame_SetRetroCheats(ROOM_IS_RETRO(rn));

			r->special = 0; // don't forget to delete this when enabling events.
			octr->special = r->special;

			// offset 0x8
			octr->boolLockedInLap = 0;
			octr->boolLockedInLevel = 0;
			octr->lapID = 0;
			octr->levelID = 0;

			octr->boolLockedInCharacter = 0;
			octr->numDriversEnded = 0;

			memset(&octr->boolLockedInCharacters[0], 0, sizeof(octr->boolLockedInCharacters));
			memset(&octr->nameBuffer[0], 0, sizeof(octr->nameBuffer));
			memset(&octr->raceStats[0], 0, sizeof(octr->raceStats));

			// reply to server with your name
			memcpy(&octr->nameBuffer[0], &name, NAME_LEN);
			octr->nameBuffer[0][NAME_LEN] = '\0';

			struct CG_MessageName m = {0};
			m.type = CG_NAME;
			memcpy(&m.name[0], &name[0], sizeof(m.name));
			sendToHostReliable(&m, sizeof(struct CG_MessageName));

			// choose to get host menu or guest menu
			octr->CurrState = LOBBY_ASSIGN_ROLE;
			break;
		}

		case SG_NAME:
		{
			struct SG_MessageName *r = (struct SG_MessageName *)recvBuf;

			int clientID = r->clientID;
			if (clientID == octr->DriverID) break;
			if (clientID < octr->DriverID) slot = clientID + 1;
			if (clientID > octr->DriverID) slot = clientID;

			octr->NumDrivers = r->numClientsTotal;

			r->name[NAME_LEN] = '\0';

			memcpy(&octr->nameBuffer[slot], &r->name[0], NAME_LEN);

			// handle disconnection
			if (r->name[0] == 0)
				ClientSlotPad(slot, 0x20);

			break;
		}

		case SG_TRACK:
		{
			struct SG_MessageTrack *r = (struct SG_MessageTrack *)recvBuf;

			// 1,3,5,7
			int numLaps = (r->lapID * 2) + 1;

			if (r->lapID == 4) numLaps = 30;
			if (r->lapID == 5) numLaps = 60;
			if (r->lapID == 6) numLaps = 90;
			if (r->lapID == 7) numLaps = 120;

			NativeOnlineGame_SetNumLaps(numLaps);

			octr->levelID = r->trackID;
			octr->CurrState = LOBBY_CHARACTER_PICK;
			break;
		}

		case SG_CHARACTER:
		{
			struct SG_MessageCharacter *r = (struct SG_MessageCharacter *)recvBuf;

			unsigned char clientID = r->clientID;
			unsigned char characterID = r->characterID;

			if (clientID == octr->DriverID) break;
			if (clientID < octr->DriverID) slot = clientID + 1;
			if (clientID > octr->DriverID) slot = clientID;

			NativeOnlineGame_SetCharacterID(slot, characterID);
			octr->boolLockedInCharacters[clientID] = r->boolLockedIn;

			break;
		}

		case SG_STARTLOADING:
		{
			// variable reuse, wait a few frames,
			// so screen updates with green names
			octr->CountPressX = 0;
			octr->CurrState = LOBBY_START_LOADING;

			break;
		}

		case SG_STARTRACE:
		{
			octr->CurrState = GAME_START_RACE;
			break;
		}

		case SG_RACEDATA:
		{
			if (octr->CurrState < GAME_WAIT_FOR_RACE)
				break;

			if (NativeOnlineGame_LoadingStage() != -1)
				break;

			struct SG_EverythingKart *r = (struct SG_EverythingKart *)recvBuf;

			int clientID = r->clientID;
			if (clientID == octr->DriverID) break;
			if (clientID < octr->DriverID) slot = clientID + 1;
			if (clientID > octr->DriverID) slot = clientID;
			if (HostBot(slot)) break;

			int curr = r->buttonHold;

			// sneak L1/R1 into one byte,
			// remove Circle/L2

			if ((curr & 0x40) != 0)
			{
				curr &= ~(0x40);
				curr |= 0x400;
			}

			if ((curr & 0x80) != 0)
			{
				curr &= ~(0x80);
				curr |= 0x800;
			}

			int prev = buttonPrev[slot];

			// tapped
			int tap = ~prev & curr;

			// released
			int rel = prev & ~curr;

			NativeOnlineGame_SetPad(slot, curr, tap, rel, prev);

			// In this order: Up, Down, Left, Right
			int stickLX, stickLY;
			if ((curr & 1) != 0) stickLY = 0;
			else if ((curr & 2) != 0) stickLY = 0xFF;
			else stickLY = 0x80;

			if ((curr & 4) != 0) stickLX = 0;
			else if ((curr & 8) != 0) stickLX = 0xFF;
			else stickLX = 0x80;

			NativeOnlineGame_SetPadStick(slot, stickLX, stickLY);

			buttonPrev[slot] = curr;

			// lossless compression, bottom byte is never used,
			// cause psx renders with 3 bytes, and top byte
			// is never used due to world scale (just pure luck)
			int angle =
				(r->kartRot1) |
				(r->kartRot2 << 5);
			angle &= 0xfff;

#if defined(__EMSCRIPTEN__) && !defined(NDEBUG)
			if (NativeOnline_DebugRaceData)
				NativeOnline_DebugRaceData(slot, ((int)r->posX) * 256, ((int)r->posY) * 256, ((int)r->posZ) * 256);
#endif

			// 11b smoothing : the pose is blended in over the next frames (SmoothFrame)
			SmoothReceive(
				slot,
				((int)r->posX) * 256,
				((int)r->posY) * 256,
				((int)r->posZ) * 256,
				angle);

			// keep setting to 200,
			// and if !boolReserves, let it fall to zero
			if (r->boolReserves)
				NativeOnlineGame_SetKartReserves(slot, 200);

			NativeOnlineGame_SetKartWumpa(slot, r->wumpa);

			break;
		}

		case SG_WEAPON:
		{
			struct SG_MessageWeapon *r = (struct SG_MessageWeapon *)recvBuf;

			int clientID = r->clientID;
			if (clientID == octr->DriverID) break;
			if (clientID < octr->DriverID) slot = clientID + 1;
			if (clientID > octr->DriverID) slot = clientID;
			if (HostBot(slot)) break;

			octr->Shoot[slot].boolNow = 1;
			octr->Shoot[slot].Weapon = r->weapon;
			octr->Shoot[slot].boolJuiced = r->juiced;
			octr->Shoot[slot].flags = r->flags;
			break;
		}

		case SG_ENDRACE:
		{
			struct SG_MessageEndRace *r = (struct SG_MessageEndRace *)recvBuf;

			int clientID = r->clientID;
			if (clientID == octr->DriverID) break;
			if (clientID < octr->DriverID) slot = clientID + 1;
			if (clientID > octr->DriverID) slot = clientID;

			// make this player hold SQUARE
			ClientSlotPad(slot, 0x20);

			// ctr-native: one result per slot, and never past the table (a kart a
			// host bot took over, session 23)
			int seen = octr->numDriversEnded >= MAX_NUM_PLAYERS;
			for (int k = 0; !seen && k < octr->numDriversEnded; k++)
				seen = octr->raceStats[k].slot == slot;
			if (seen) break;

			octr->raceStats[octr->numDriversEnded].slot = slot;
			memcpy(&octr->raceStats[octr->numDriversEnded].finalTime, &r->courseTime, sizeof(r->courseTime));
			memcpy(&octr->raceStats[octr->numDriversEnded].bestLap, &r->lapTime, sizeof(r->lapTime));
			octr->numDriversEnded++;
			break;
		}

		default:
			break;
	}
}

static void Disconnect(void)
{
	if (botHooks)
		botHooks->leave();
	if (boolConnected || boolConnecting)
		transport->disconnect();

	boolConnected = 0;
	boolConnecting = 0;
}

static int SlotEnded(int slot)
{
	for (int k = 0; k < octr->numDriversEnded; k++)
		if (octr->raceStats[k].slot == slot)
			return 1;
	return 0;
}

static void SoloEnd(int slot, int clock)
{
	struct NativeOnlineKart kart = {0};

	if (octr->numDriversEnded >= MAX_NUM_PLAYERS || SlotEnded(slot))
		return;
	NativeOnlineGame_GetKart(slot, &kart);
	octr->raceStats[octr->numDriversEnded].slot = slot;
	octr->raceStats[octr->numDriversEnded].finalTime = clock;
	octr->raceStats[octr->numDriversEnded].bestLap = kart.bestLapTime;
	octr->numDriversEnded++;
}

// The host's link closed (web/online/net.js) during this guest's race : the
// unfinished karts go to this game's AI as the host's takeover does (D11.6).
// 0 : not in a race this game can finish (the host itself, a load, Battle).
static int GoSolo(void)
{
	if (octr->DriverID == 0 || octr->CurrState < GAME_WAIT_FOR_RACE || octr->CurrState > GAME_END_RACE ||
		NativeOnlineGame_LoadingStage() != -1 || !NativeOnlineGame_PrepareAI())
		return 0;

	SmoothReset();
	soloRace = 1;
	soloEndAt = 0;
	for (int slot = 1; slot < octr->NumDrivers && slot < MAX_NUM_PLAYERS; slot++)
	{
		if (octr->nameBuffer[slot][0] == 0 || SlotEnded(slot) || HostBot(slot))
			continue;
		// a kart that cannot drive on (none, or its finish flag already on) ends now
		if (!NativeOnlineGame_TakeOverKart(slot))
			SoloEnd(slot, NativeOnlineGame_RaceClock());
	}
	NativeOnlineGame_Log("[OnlineCTR] The host left : this game finishes the race alone (AI 0x%x)\n", *NativeOnlineGame_HostBots());
	return 1;
}

static void SoloFrame(void)
{
	// read every frame : past this player's finish the clock only counts on while it is read
	const int clock = NativeOnlineGame_RaceClock();
	int named = 0;

	for (int slot = 0; slot < octr->NumDrivers && slot < MAX_NUM_PLAYERS; slot++)
	{
		if (octr->nameBuffer[slot][0] == 0)
			continue;
		named++;
		if (slot != 0 && NativeOnlineGame_KartFinished(slot))
			SoloEnd(slot, clock);
	}

	// HasRaceEnded (hooks.c) : the results are complete, shown as long as the room shows them
	if (octr->CurrState != GAME_END_RACE || octr->numDriversEnded < named)
		return;
	if (soloEndAt == 0)
		soloEndAt = clock + SOLO_RESULTS_MS;
	else if (clock >= soloEndAt)
	{
		NativeOnlineGame_Log("[OnlineCTR] The race finished alone : back to the title\n");
		soloRace = 0;
		NativeOnlineGame_Deactivate();
	}
}

static void ProcessNewMessages(void)
{
	unsigned char packet[NATIVE_ONLINE_MAX_PACKET];
	int event;
	int len;

	if (!boolConnected)
		return;

	while ((len = transport->poll(packet, sizeof(packet), &event)) >= 0)
	{
		switch (event)
		{
			case ONLINE_EVENT_DATA:
				ProcessReceiveEvent(packet, len);
				break;

			case ONLINE_EVENT_DISCONNECTED:
				NativeOnlineGame_Log("[OnlineCTR] Connection dropped (server full or offline)\n");
				boolConnected = 0;
				if (GoSolo())
					return;

				// to go the lobby browser
				octr->CurrState = -1;
				return;

			default:
				break;
		}
	}
}

static void DisconSELECT(void)
{
	int hold = NativeOnlineGame_PadHeld(0);

	if ((hold & 0x2000) != 0)
	{
		NativeOnlineGame_Log("[OnlineCTR] Disconnected (SELECT)\n");
		Disconnect();

		octr->autoRetryJoinRoomIndex = -1;
		// to go the lobby browser
		octr->CurrState = -1;
		return;
	}
}

void StatePC_Launch_EnterPID()
{
	// nothing to attach to: the game is in this process
	if (!octr->IsBootedPS1)
		return;

	octr->CurrState = LAUNCH_PICK_SERVER;
}

// Address of each entry of the server menu (menu.c countryNames)
static const char *ServerAddress(int serverCountry)
{
	switch (serverCountry)
	{
		case 0: return "eur1.online-ctr.net:64001"; // EUROPE
		case 1: return "usa3.online-ctr.net:64001"; // USA (New York City)
		case 2: return "usa2.online-ctr.net:64001"; // Mexico (USA West)
		case 3: return "brz1.online-ctr.net:64001"; // BRAZIL
		case 4: return "aus1.online-ctr.net:2096";  // AUSTRALIA (Sydney)
		case 5: return "sgp1.online-ctr.net:64001"; // SINGAPORE
		case 6: return "usa1.online-ctr.net:64001"; // BETA (New Jersey)
		default: return privateServer;              // PRIVATE SERVER
	}
}

static void StartConnect(void)
{
	NativeOnlineGame_Log("[OnlineCTR] Connecting to %s (ID: %d, attempt %d/%d)\n",
		connectAddress, octr->serverCountry, connectRetry + 1, NATIVE_ONLINE_CONNECT_RETRIES);

	connectStartMs = NativeOnlineGame_NowMs();
	boolConnecting = (transport->connect(connectAddress) == 0);
}

// Upstream blocked in enet_host_service() for up to 3 x 3 s here ;
// the in-process client polls instead, one step per frame.
static void ConnectStep(void)
{
	unsigned char packet[NATIVE_ONLINE_MAX_PACKET];
	int event = ONLINE_EVENT_NONE;

	if (boolConnecting)
	{
		while (transport->poll(packet, sizeof(packet), &event) >= 0)
			if (event != ONLINE_EVENT_DATA)
				break;
	}

	if (boolConnecting && event == ONLINE_EVENT_CONNECTED)
	{
		NativeOnlineGame_Log("[OnlineCTR] Connected\n");
		boolConnecting = 0;
		boolConnected = 1;

		octr->DriverID = -1;
		octr->CurrState = LAUNCH_PICK_ROOM;
		octr->boolClientBusy = 0;
		return;
	}

	if (boolConnecting &&
		event != ONLINE_EVENT_DISCONNECTED &&
		(NativeOnlineGame_NowMs() - connectStartMs) < NATIVE_ONLINE_CONNECT_TIMEOUT_MS)
		return;

	// failed attempt
	Disconnect();
	connectRetry++;

	if (connectRetry < NATIVE_ONLINE_CONNECT_RETRIES)
	{
		StartConnect();
		return;
	}

	NativeOnlineGame_Log("[OnlineCTR] Failed to connect\n");

	// back to the server menu (thread.c reopens it)
	octr->boolClientBusy = 0;
	octr->CurrState = -1;
}

void StatePC_Launch_PickServer()
{
	// connection in progress
	if (octr->boolClientBusy)
	{
		ConnectStep();
		return;
	}

	// must be in cutscene level to see country selector
	// (the web's lobby is the game's own menus, on any level)
	if (!NativeOnlineGame_ExternalLobby() && NativeOnlineGame_LevelID() != 0x26)
		return;

	// quit if in loading screen (force-reconnect)
	if (NativeOnlineGame_LoadingStage() != -1)
		return;

	if (boolConnected || boolConnecting)
	{
		NativeOnlineGame_Log("[OnlineCTR] Disconnecting from old server\n");
		Disconnect();
	}

	// return now if the server selection hasn't been selected yet
	if (octr->serverLockIn1 == 0)
		return;

	// === Now Selecting Country ===
	octr->boolClientBusy = 1;

	snprintf(connectAddress, sizeof(connectAddress), "%s", ServerAddress(octr->serverCountry));
	connectRetry = 0;
	StartConnect();
}

void StatePC_Launch_Error()
{
	// do nothing
}

static int connAttempt = 0;
static int countFrame = 0;
void StatePC_Launch_PickRoom()
{
	countFrame++;
	if (countFrame == 30 * 5) //just in case server's tracking & updating is flawed
	{
		countFrame = 0;

		// send junk data,
		// this triggers server response
		struct CG_MessageRoom mr = {0};
		mr.type = CG_JOINROOM;
		mr.room = 0xFF;

		sendToHostReliable(&mr, sizeof(struct CG_MessageRoom));
	}

	// wait for room to be chosen
	if (!octr->serverLockIn2)
	{
		connAttempt = 0;
		return;
	}

	// dont send CG_JoinRoom twice
	if (connAttempt == 1)
		return;

	connAttempt = 1;

	struct CG_MessageRoom mr = {0};
	mr.type = CG_JOINROOM;
	mr.room = octr->serverRoom;
	octr->autoRetryJoinRoomIndex = -1;

	sendToHostReliable(&mr, sizeof(struct CG_MessageRoom));
}

void StatePC_Lobby_AssignRole()
{
	connAttempt = 0;
	countFrame = 0;
}

void StatePC_Lobby_HostTrackPick()
{
	// boolLockedInLap gets set after
	// boolLockedInLevel already sets
	if (!octr->boolLockedInLap) return;

	NativeOnlineGame_Log("[OnlineCTR] Sending track to the server\n");

	struct CG_MessageTrack mt = {0};
	mt.type = CG_TRACK;

	mt.trackID = octr->levelID;
	mt.lapID = octr->lapID;

	// 1,3,5,7
	char numLaps = (mt.lapID * 2) + 1;

	if (mt.lapID == 4) numLaps = 30;
	if (mt.lapID == 5) numLaps = 60;
	if (mt.lapID == 6) numLaps = 90;
	if (mt.lapID == 7) numLaps = 120;

	NativeOnlineGame_SetNumLaps(numLaps);

	// ONLINE > ARCADE : the host's bots enter while the room is open (D11.1)
	if (botHooks)
		botHooks->join();

	sendToHostReliable(&mt, sizeof(struct CG_MessageTrack));

	if (botHooks)
		botHooks->lock();

	octr->CurrState = LOBBY_CHARACTER_PICK;
}

static int prev_characterID = -1;
static int prev_boolLockedIn = -1;

void StatePC_Lobby_GuestTrackWait()
{
	prev_characterID = -1;
	prev_boolLockedIn = -1;
}

void StatePC_Lobby_CharacterPick()
{
	struct CG_MessageCharacter mc = {0};
	mc.type = CG_CHARACTER;

	// data.characterIDs[0]
	mc.characterID = NativeOnlineGame_CharacterID(0);

	mc.boolLockedIn = octr->boolLockedInCharacters[octr->DriverID];

	if (
		(prev_characterID != mc.characterID) ||
		(prev_boolLockedIn != mc.boolLockedIn)
		)
	{
		prev_characterID = mc.characterID;
		prev_boolLockedIn = mc.boolLockedIn;

		sendToHostReliable(&mc, sizeof(struct CG_MessageCharacter));
	}

	if (mc.boolLockedIn == 1)
	{
		octr->CurrState = LOBBY_WAIT_FOR_LOADING;
	}
}

void StatePC_Lobby_WaitForLoading()
{
	// if recv message to start loading,
	// change state to StartLoading,
	// this check happens in ProcessNewMessages
}

static int boolAlreadySent_StartRace = 0;
static int boolAlreadySent_EndRace = 0;

void StatePC_Lobby_StartLoading()
{
	boolAlreadySent_StartRace = 0;
	boolAlreadySent_EndRace = 0;
}

static void SendEverything(void)
{
	struct CG_EverythingKart cg = {0};
	struct NativeOnlineKart kart;
	cg.type = CG_RACEDATA;

	if (!NativeOnlineGame_GetKart(0, &kart))
		return;

	int hold = NativeOnlineGame_PadHeld(0);

	// ignore Circle/L2
	hold &= ~(0xC0);

	// put L1/R1 into one byte
	if ((hold & 0x400) != 0) hold |= 0x40;
	if ((hold & 0x800) != 0) hold |= 0x80;

	cg.buttonHold = (unsigned char)hold;

	// === Position ===
	// lossless compression, bottom byte is never used,
	// cause psx renders with 3 bytes, and top byte
	// is never used due to world scale (just pure luck)
	cg.posX = (short)(kart.posX / 256);
	cg.posY = (short)(kart.posY / 256);
	cg.posZ = (short)(kart.posZ / 256);

	// === Direction Faced ===
	unsigned short angle = (unsigned short)kart.angle;
	angle &= 0xfff;

	unsigned char angleBit5 = angle & 0x1f;
	unsigned char angleTop8 = angle >> 5;
	cg.kartRot1 = angleBit5;
	cg.kartRot2 = angleTop8;

	cg.wumpa = (unsigned char)kart.numWumpas;

	// must be read as unsigned, even though game uses signed,
	// has to do with infinite reserves when the number is negative
	unsigned short reserves = (unsigned short)kart.reserves;
	cg.boolReserves = (reserves > 200);

	// TO DO: No Fire Level yet

	sendToHostUnreliable(&cg, sizeof(struct CG_EverythingKart));

	if (octr->Shoot[0].boolNow == 1)
	{
		octr->Shoot[0].boolNow = 0;

		struct CG_MessageWeapon w = {0};

		w.type = CG_WEAPON;
		w.weapon = octr->Shoot[0].Weapon;
		w.juiced = octr->Shoot[0].boolJuiced;
		w.flags = octr->Shoot[0].flags;

		sendToHostReliable(&w, sizeof(struct CG_MessageWeapon));
	}
}

void StatePC_Game_WaitForRace()
{
	if (
		// only send once
		(!boolAlreadySent_StartRace) &&

		// after camera fly-in is done
		((NativeOnlineGame_GameMode1() & 0x40) == 0)
		)
	{
		NativeOnlineGame_Log("[OnlineCTR] Online race in progress\n");
		boolAlreadySent_StartRace = 1;

		struct CG_Header cg = {0};
		cg.type = CG_STARTRACE;

		sendToHostReliable(&cg, sizeof(struct CG_Header));
	}

	SendEverything();
}

void StatePC_Game_StartRace()
{
	SendEverything();
}

void StatePC_Game_EndRace()
{
	if (!boolAlreadySent_EndRace)
	{
		struct NativeOnlineKart kart = {0};
		boolAlreadySent_EndRace = 1;

		NativeOnlineGame_GetKart(0, &kart);

		struct CG_MessageEndRace cg = {0};
		cg.type = CG_ENDRACE;

		int courseTime = kart.courseTime;
		int bestLapTime = kart.bestLapTime;

		memcpy(&cg.courseTime, &courseTime, sizeof(cg.courseTime));
		memcpy(&cg.lapTime, &bestLapTime, sizeof(cg.courseTime));

		sendToHostReliable(&cg, sizeof(struct CG_MessageEndRace));

		// end race for yourself
		octr->raceStats[octr->numDriversEnded].slot = 0;
		octr->raceStats[octr->numDriversEnded].finalTime = courseTime;
		octr->raceStats[octr->numDriversEnded].bestLap = bestLapTime;
		octr->numDriversEnded++;
	}
}

static void (*ClientState[])(void) = {
	StatePC_Launch_EnterPID,		// 0
	StatePC_Launch_PickServer,		// 1
	StatePC_Launch_PickRoom,		// 2
	StatePC_Launch_Error,			// 3
	StatePC_Lobby_AssignRole,		// 4
	StatePC_Lobby_HostTrackPick,	// 5
	StatePC_Lobby_GuestTrackWait,	// 6
	StatePC_Lobby_CharacterPick,	// 7
	StatePC_Lobby_WaitForLoading,	// 8
	StatePC_Lobby_StartLoading,		// 9
	StatePC_Game_WaitForRace,		// 10
	StatePC_Game_StartRace,			// 11
	StatePC_Game_EndRace			// 12
};

void NativeOnline_Configure(const OnlineTransport *t, const char *playerName, const char *serverAddress)
{
	const char *env;

	transport = t;

	if (!playerName && (env = getenv("CTR_ONLINE_NAME")) && env[0])
		playerName = env;
	if (playerName)
	{
		memset(name, 0, sizeof(name));
		strncpy(name, playerName, NAME_LEN);
	}

	if (!serverAddress && (env = getenv("CTR_ONLINE_SERVER")) && env[0])
		serverAddress = env;
	if (serverAddress)
		snprintf(privateServer, sizeof(privateServer), "%s", serverAddress);
}

void NativeOnline_SetControl(int (*poll)(int *arg))
{
	controlPoll = poll;
}

void NativeOnline_SetBotHooks(const NativeOnlineBotHooks *hooks)
{
	botHooks = hooks;
}

// The host layer's commands (web) ; ENTER waits until the game can join.
static void ProcessControl(void)
{
	int cmd, arg = 0;

	if (!controlPoll)
		return;

	while ((cmd = controlPoll(&arg)) != NATIVE_ONLINE_CTL_NONE)
	{
		switch (cmd)
		{
			case NATIVE_ONLINE_CTL_ENTER:
				pendingEnter = 1;
				break;

			case NATIVE_ONLINE_CTL_LEAVE:
				pendingEnter = 0;
				soloRace = 0;
				if (NativeOnlineGame_Active())
				{
					NativeOnlineGame_Log("[OnlineCTR] Left the room\n");
					Disconnect();
					NativeOnlineGame_Deactivate();
				}
				break;

			case NATIVE_ONLINE_CTL_CHARACTER:
				NativeOnlineGame_SetMyCharacter(arg);
				break;

			// the room's end-of-race timeout (session 11b) : the game ends this
			// player's race, StatePC_Game_EndRace then sends its CG_ENDRACE
			case NATIVE_ONLINE_CTL_END_RACE:
				if (NativeOnlineGame_Active() && octr->CurrState >= GAME_WAIT_FOR_RACE && octr->CurrState < GAME_END_RACE)
				{
					NativeOnlineGame_Log("[OnlineCTR] Race ended by the room's timeout\n");
					NativeOnlineGame_EndMyRace();
				}
				break;

			// the same timeout on the host : its bots still racing end where they are
			case NATIVE_ONLINE_CTL_END_BOTS:
				NativeOnlineGame_Log("[OnlineCTR] The room's timeout ends the bots 0x%x\n", *NativeOnlineGame_HostBots());
				for (int slot = 1; slot < MAX_NUM_PLAYERS; slot++)
					if (HostBot(slot))
						NativeOnlineGame_EndBotRace(slot);
				break;

			default:
				break;
		}
	}

	if (pendingEnter && !NativeOnlineGame_Active() && NativeOnlineGame_Activate())
	{
		pendingEnter = 0;
		soloRace = 0;
		connectRetry = 0;
		lastLoggedState = -100;
		// « Private Room », as the server menu's Cross would
		octr->serverCountry = 7;
		octr->serverLockIn1 = 1;
		NativeOnlineGame_Log("[OnlineCTR] Joined the page's room\n");
	}
}

void NativeOnline_Frame(void)
{
	if (!octr)
	{
		octr = NativeOnlineGame_Octr();
		octr->autoRetryJoinRoomIndex = -1;
	}

	if (!transport)
	{
#ifdef NATIVE_ONLINE_HAS_ENET
		NativeOnline_Configure(&NativeOnline_EnetTransport, NULL, NULL);
#else
		return;
#endif
	}

	// one build : nothing runs until a room is joined
	ProcessControl();
	NativeOnlineGame_SyncStats();
	if (!NativeOnlineGame_Active())
		return;

	// the game dropped the connection (thread.c, a race left) : close the transport
	if (octr->CurrState < 0 && (boolConnected || boolConnecting))
		Disconnect();

	frameCount++;

	// R6: one line per state change and every 10 s, to see the bridge run
	// every frame through menu -> room -> loading -> race -> end
	if ((octr->CurrState != lastLoggedState) || ((frameCount % 600) == 0))
	{
		NativeOnlineGame_Log("[OnlineCTR] frame %u: state %d (level %d, loading %d)\n",
			frameCount, octr->CurrState, NativeOnlineGame_LevelID(), NativeOnlineGame_LoadingStage());
		lastLoggedState = octr->CurrState;
	}

	//technechally windowsClientSync just needs to *change* every frame.
	octr->windowsClientSync++;

	// should rename to room selection
	if (octr->CurrState >= LAUNCH_PICK_ROOM)
		DisconSELECT();

	//send data
	if (octr->CurrState >= 0 && octr->CurrState < NUM_STATES)
		ClientState[octr->CurrState]();

	// the host's bots, after its own kart (D11.1)
	if (botHooks && boolConnected)
		botHooks->frame();

	if (soloRace)
		SoloFrame();

	// now check for new RECV message
	ProcessNewMessages();

	// 11b smoothing
	SmoothFrame();
}

unsigned int NativeOnline_FrameCount(void)
{
	return frameCount;
}
