// The host's bots in an Online room (docs/ONLINECTR_PORT.md, D11).
//
// Each bot is a virtual client of the host's own server core : its own peer
// id and address key, its own CG_JOINROOM / CG_NAME / CG_CHARACTER in the
// lobby, its CG_STARTRACE / CG_RACEDATA / CG_WEAPON / CG_ENDRACE in the race,
// built from the host's drivers[slot], which the host's AI drives. Guests
// see an ordinary remote kart : no new message, no field change, sv_core.c
// unchanged. A guest who leaves an ONLINE > ARCADE race keeps its peer here :
// the core never sees the disconnect until the room's reset, and a bot
// drives its kart on (D11.6).
//
// Calls into the core are synchronous, as the loopback's, and only from the
// game loop (D6) : the bridge's frame, or the web host's service.

#include <string.h>

#define WINDOWS_INCLUDE
#include "../game/OnlineCTR/global.h"

#include "native_online.h"
#include "native_online_game.h"
#include "native_online_bots.h"

// the page's room (D9) ; address keys of their own (net.js : a 64-bit FNV hash per guest link)
#define BOT_ROOM 5
#define BOT_ADDRESS_KEY(peer) ((0xB0750000ull << 32) | (unsigned int)(peer))
#define BOT_NUM_BASE_CHARACTERS 8
// a bot's pad on the wire (D11.3) : Cross, and Left / Right past this turn per frame
#define BOT_PAD_CROSS 0x10
#define BOT_PAD_LEFT 0x4
#define BOT_PAD_RIGHT 0x8
#define BOT_STEER_DEADZONE 6

struct VirtualPeer
{
	int used;
	int peer;
	int slot;     // its clientID, the host's driver slot ; -1 until SG_NEWCLIENT
	int takeover; // a leaver's peer, kept (D11.6)
	int character;
	int raced;    // CG_STARTRACE sent : its next SG_NEWCLIENT is the room's reset
	int ended;
	int leave;    // disconnect from the core on the next frame
	int prevAngle;
};

static struct VirtualPeer vp[MAX_NUM_PLAYERS];
static signed char clientOf[SV_CORE_MAX_PEERS]; // every peer's clientID (SG_NEWCLIENT), -1 none
static SvCoreHost inner;
static SvCoreHost wrapped;

static struct VirtualPeer *Find(int peerId)
{
	for (int i = 0; i < MAX_NUM_PLAYERS; i++)
		if (vp[i].used && vp[i].peer == peerId)
			return &vp[i];
	return NULL;
}

static struct VirtualPeer *NewPeer(int peerId)
{
	for (int i = 0; i < MAX_NUM_PLAYERS; i++)
	{
		if (!vp[i].used)
		{
			memset(&vp[i], 0, sizeof(vp[i]));
			vp[i].used = 1;
			vp[i].peer = peerId;
			vp[i].slot = -1;
			return &vp[i];
		}
	}
	return NULL;
}

static void Release(struct VirtualPeer *v)
{
	int *hostBots = NativeOnlineGame_HostBots();

	if (v->slot >= 0)
		*hostBots &= ~(1 << v->slot);
	memset(v, 0, sizeof(*v));
}

// === server core side ===

static void Bots_CoreSend(int peerId, const void *buf, int len, int reliable)
{
	struct VirtualPeer *v = Find(peerId);

	if (len > 0 && ((const struct SG_Header *)buf)->type == SG_NEWCLIENT)
	{
		int clientID = ((const struct SG_MessageClientStatus *)buf)->clientID;

		clientOf[peerId] = (signed char)clientID;
		if (v && v->raced)
			v->leave = 1; // the room's reset after the race
		else if (v)
			v->slot = clientID;
	}

	if (v)
		return;
	inner.send(peerId, buf, len, reliable);
}

static void Bots_CoreKick(int peerId)
{
	struct VirtualPeer *v = Find(peerId);

	if (v)
	{
		v->leave = 1;
		return;
	}
	inner.kick(peerId);
}

static void Bots_CoreSetTimeout(int peerId, int ms)
{
	if (!Find(peerId) && inner.setTimeout)
		inner.setTimeout(peerId, ms);
}

// === the bots' messages ===

static void Send(struct VirtualPeer *v, const void *buf, int len)
{
	SvCore_Receive(v->peer, buf, len);
}

static int CharacterTaken(int characterID)
{
	for (int i = 0; i < 4; i++)
		if (NativeOnlineGame_LobbyCharacter(i) == characterID)
			return 1;
	for (int i = 0; i < MAX_NUM_PLAYERS; i++)
		if (vp[i].used && !vp[i].takeover && vp[i].character == characterID)
			return 1;
	return 0;
}

// Before CG_TRACK locks the room : the bots fill it up to 8, each named
// after the character it will drive (the base 8 the humans did not lock, in
// order, as solo Arcade's LOAD_Robots1P).
static void Bots_Join(void)
{
	struct OnlineCTR *o = NativeOnlineGame_Octr();
	int *hostBots = NativeOnlineGame_HostBots();
	int humans = 0;

	if (!NativeOnlineGame_LobbyBots() || o->DriverID != 0)
		return;

	for (int i = 0; i < MAX_NUM_PLAYERS; i++)
		if (o->nameBuffer[i][0])
			humans++;

	for (int peer = NATIVE_ONLINE_BOT_PEER_FIRST; humans < MAX_NUM_PLAYERS && peer < NATIVE_ONLINE_BOT_PEER_FIRST + 7; peer++)
	{
		struct VirtualPeer *v;
		int character = 0;

		if (Find(peer))
			continue;
		while (character < BOT_NUM_BASE_CHARACTERS && CharacterTaken(character))
			character++;
		if (character == BOT_NUM_BASE_CHARACTERS || !(v = NewPeer(peer)))
			break;
		v->character = character;

		SvCore_Connect(peer, BOT_ADDRESS_KEY(peer));

		struct CG_MessageRoom mr = {0};
		mr.type = CG_JOINROOM;
		mr.room = BOT_ROOM;
		Send(v, &mr, sizeof(mr));
		if (v->slot < 0)
		{
			// refused (full, locked) : the core answered with SG_ROOMS only
			SvCore_Disconnect(peer);
			Release(v);
			break;
		}

		struct CG_MessageName mn = {0};
		mn.type = CG_NAME;
		NativeOnlineGame_CharacterName(character, mn.name, NAME_LEN + 1);
		Send(v, &mn, sizeof(mn));

		*hostBots |= 1 << v->slot;
		humans++;
		NativeOnlineGame_Log("[OnlineCTR] Bot %s joined, slot %d\n", mn.name, v->slot);
	}
}

// After CG_TRACK : the bots' characters, locked (never replayed to a later
// joiner, so after every guest is in).
static void Bots_Lock(void)
{
	for (int i = 0; i < MAX_NUM_PLAYERS; i++)
	{
		struct VirtualPeer *v = &vp[i];

		if (!v->used || v->takeover || v->slot < 0)
			continue;

		struct CG_MessageCharacter mc = {0};
		mc.type = CG_CHARACTER;
		mc.characterID = v->character;
		mc.boolLockedIn = 1;
		Send(v, &mc, sizeof(mc));
	}
}

static int WrapAngle(int a)
{
	a &= 0xfff;
	return a >= 0x800 ? a - 0x1000 : a;
}

static void SendRaceData(struct VirtualPeer *v, const struct NativeOnlineKart *kart)
{
	struct CG_EverythingKart cg = {0};
	int turn = WrapAngle(kart->angle - v->prevAngle);
	int hold = BOT_PAD_CROSS;

	v->prevAngle = kart->angle;
	if (turn > BOT_STEER_DEADZONE)
		hold |= BOT_PAD_LEFT;
	else if (turn < -BOT_STEER_DEADZONE)
		hold |= BOT_PAD_RIGHT;

	// as SendEverything (native_online.c) for the host's own kart
	cg.type = CG_RACEDATA;
	cg.buttonHold = (unsigned char)hold;
	cg.posX = (short)(kart->posX / 256);
	cg.posY = (short)(kart->posY / 256);
	cg.posZ = (short)(kart->posZ / 256);
	unsigned short angle = (unsigned short)kart->angle & 0xfff;
	cg.kartRot1 = angle & 0x1f;
	cg.kartRot2 = angle >> 5;
	cg.wumpa = (unsigned char)kart->numWumpas;
	cg.boolReserves = ((unsigned short)kart->reserves > 200);
	Send(v, &cg, sizeof(cg));
}

// another ended bot whose estimated time comes before `courseTime` and is not sent yet
static int EarlierBotPending(const struct VirtualPeer *self, int courseTime)
{
	for (int i = 0; i < MAX_NUM_PLAYERS; i++)
	{
		const struct VirtualPeer *v = &vp[i];
		int t;

		if (v == self || !v->used || v->ended || v->slot < 0 || !NativeOnlineGame_KartFinished(v->slot))
			continue;
		t = NativeOnlineGame_BotEndTime(v->slot);
		if (t > 0 && t < courseTime)
			return 1;
	}
	return 0;
}

// Once per bridge frame, after the host's own messages.
static void Bots_Frame(void)
{
	struct OnlineCTR *o = NativeOnlineGame_Octr();
	int racing = o->CurrState >= GAME_WAIT_FOR_RACE && NativeOnlineGame_LoadingStage() == -1;
	int clock = NativeOnlineGame_RaceClock(); // every frame : it counts on past the host's finish

	for (int i = 0; i < MAX_NUM_PLAYERS; i++)
	{
		struct VirtualPeer *v = &vp[i];
		struct NativeOnlineKart kart;
		int weapon, juiced, flags;

		if (!v->used)
			continue;
		if (v->leave)
		{
			int peer = v->peer;
			Release(v);
			clientOf[peer] = -1;
			SvCore_Disconnect(peer);
			continue;
		}
		if (!racing || v->slot < 0 || v->ended)
			continue;

		// after the fly-in, as the host's own (StatePC_Game_WaitForRace)
		if (!v->raced && (NativeOnlineGame_GameMode1() & 0x40) == 0)
		{
			struct CG_Header cg = {0};
			cg.type = CG_STARTRACE;
			Send(v, &cg, sizeof(cg));
			v->raced = 1;
		}

		// no driver for it (no nav path on this track) : it ends at once, the room must not wait
		if (!NativeOnlineGame_GetKart(v->slot, &kart))
		{
			struct CG_MessageEndRace cg = {0};
			cg.type = CG_ENDRACE;
			memcpy(&cg.courseTime, &clock, sizeof(cg.courseTime));
			Send(v, &cg, sizeof(cg));
			v->ended = 1;
			continue;
		}

		if (NativeOnlineGame_TakeBotShot(v->slot, &weapon, &juiced, &flags))
		{
			struct CG_MessageWeapon w = {0};
			w.type = CG_WEAPON;
			w.weapon = weapon;
			w.juiced = juiced;
			w.flags = flags;
			Send(v, &w, sizeof(w));
		}

		// a finished player sends no more kart states (StatePC_Game_EndRace) ; a bot ended
		// where it stood (session 32c) has its estimated time, sent after any ahead of it so the
		// results keep the race's order
		if (NativeOnlineGame_KartFinished(v->slot))
		{
			struct CG_MessageEndRace cg = {0};
			int courseTime = NativeOnlineGame_BotEndTime(v->slot) ? NativeOnlineGame_BotEndTime(v->slot) : clock;

			if (EarlierBotPending(v, courseTime))
				continue;
			int bestLapTime = kart.bestLapTime;

			cg.type = CG_ENDRACE;
			memcpy(&cg.courseTime, &courseTime, sizeof(cg.courseTime));
			memcpy(&cg.lapTime, &bestLapTime, sizeof(cg.lapTime));
			Send(v, &cg, sizeof(cg));
			v->ended = 1;
			NativeOnlineGame_Log("[OnlineCTR] Bot slot %d finished, clock %d\n", v->slot, courseTime);
			continue;
		}

		SendRaceData(v, &kart);
	}
}

// The host's client leaves the room : so do its bots and the peers it kept.
static void Bots_Leave(void)
{
	for (int i = 0; i < MAX_NUM_PLAYERS; i++)
	{
		if (vp[i].used)
		{
			int peer = vp[i].peer;
			Release(&vp[i]);
			clientOf[peer] = -1;
			SvCore_Disconnect(peer);
		}
	}
	*NativeOnlineGame_HostBots() = 0;
}

int NativeOnlineBots_TakeOver(int peerId)
{
	struct OnlineCTR *o = NativeOnlineGame_Octr();
	struct VirtualPeer *v;
	int slot;

	if (peerId < 0 || peerId >= SV_CORE_MAX_PEERS || Find(peerId))
		return 0;
	slot = clientOf[peerId];

	// an ONLINE > ARCADE race (its bots are in), on the race level, the host
	// its server (slot = clientID), the leaver not finished
	if (*NativeOnlineGame_HostBots() == 0 || o->DriverID != 0 || slot <= 0 ||
		o->CurrState < GAME_WAIT_FOR_RACE || NativeOnlineGame_LoadingStage() != -1)
		return 0;
	for (int k = 0; k < o->numDriversEnded; k++)
		if (o->raceStats[k].slot == slot)
			return 0;
	// its CG_ENDRACE may sit in this same drain, ahead of the close
	if (NativeOnlineGame_KartFinished(slot))
		return 0;

	if (!(v = NewPeer(peerId)))
		return 0;
	v->slot = slot;
	v->takeover = 1;
	if (!NativeOnlineGame_TakeOverKart(slot))
	{
		memset(v, 0, sizeof(*v));
		return 0;
	}

	// harmless if it had : the core only sets boolRaceSelf
	struct CG_Header cg = {0};
	cg.type = CG_STARTRACE;
	Send(v, &cg, sizeof(cg));
	v->raced = 1;

	NativeOnlineGame_Log("[OnlineCTR] %.*s left the race : a bot drives slot %d on\n", NAME_LEN, o->nameBuffer[slot], slot);
	return 1;
}

static const NativeOnlineBotHooks hooks = {
	Bots_Join,
	Bots_Lock,
	Bots_Frame,
	Bots_Leave,
};

const SvCoreHost *NativeOnlineBots_Wrap(const SvCoreHost *innerHost)
{
	inner = *innerHost;
	wrapped = inner;
	wrapped.send = Bots_CoreSend;
	wrapped.kick = Bots_CoreKick;
	wrapped.setTimeout = Bots_CoreSetTimeout;
	memset(vp, 0, sizeof(vp));
	memset(clientOf, -1, sizeof(clientOf));
	NativeOnline_SetBotHooks(&hooks);
	return &wrapped;
}
