// Remote-kart smoothing (session 11b, platform/native_online.c) : a received
// pose close to the kart is blended in over a few frames, without overshoot ;
// a far one snaps at once ; the angle goes the short way round 4096.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "stub_game.h"
#include "../../platform/native_online.h"

static unsigned char inbox[8][16];
static int inboxLen[8];
static int inboxCount;
static int connected;

static int Fake_Connect(const char *address) { (void)address; connected = 0; return 0; }
static void Fake_Send(const void *data, int size, int reliable) { (void)data; (void)size; (void)reliable; }
static void Fake_Disconnect(void) {}
static int Fake_Poll(void *buf, int size, int *event)
{
	if (!connected)
	{
		connected = 1;
		*event = ONLINE_EVENT_CONNECTED;
		return 0;
	}
	if (inboxCount == 0)
		return -1;
	inboxCount--;
	memcpy(buf, inbox[0], inboxLen[0] < size ? inboxLen[0] : size);
	int len = inboxLen[0];
	memmove(&inbox[0], &inbox[1], sizeof(inbox[0]) * 7);
	memmove(&inboxLen[0], &inboxLen[1], sizeof(inboxLen[0]) * 7);
	*event = ONLINE_EVENT_DATA;
	return len;
}
static const OnlineTransport fake = {Fake_Connect, Fake_Send, Fake_Poll, Fake_Disconnect};

// an SG_RACEDATA from client 1 (slot 1 for us, client 0), world units
static void Receive(int x, int y, int z, int angle)
{
	struct SG_EverythingKart k;

	memset(&k, 0, sizeof(k));
	k.type = SG_RACEDATA;
	k.clientID = 1;
	k.kartRot1 = angle & 0x1f;
	k.kartRot2 = (angle & 0xfff) >> 5;
	k.posX = (short)x;
	k.posY = (short)y;
	k.posZ = (short)z;
	memcpy(inbox[inboxCount], &k, sizeof(k));
	inboxLen[inboxCount] = sizeof(k);
	inboxCount++;
}

static int failures;
#define EXPECT(cond, ...) do { if (!(cond)) { printf("FAILED: " __VA_ARGS__); printf("\n"); failures++; } } while (0)

int main(void)
{
	struct NativeOnlineKart *k = &stub.karts[1];

	StubGame_Boot();
	NativeOnline_Configure(&fake, "Test", "fake");
	stub.octr.CurrState = LAUNCH_PICK_SERVER;
	stub.octr.serverLockIn1 = 1;
	NativeOnline_Frame(); // connect
	NativeOnline_Frame(); // connected : LAUNCH_PICK_ROOM
	EXPECT(stub.octr.CurrState == LAUNCH_PICK_ROOM, "not connected (state %d)", stub.octr.CurrState);

	stub.octr.CurrState = GAME_START_RACE;
	stub.octr.DriverID = 0;
	stub.kartExists[1] = 1;

	// far : a snap in the frame it arrives
	Receive(2000, 10, -3000, 100);
	NativeOnline_Frame();
	EXPECT(k->posX == 2000 * 256 && k->posY == 10 * 256 && k->posZ == -3000 * 256 && k->angle == 100,
		"far pose not snapped : %d %d %d / %d", k->posX >> 8, k->posY >> 8, k->posZ >> 8, k->angle);

	// near : 40 units ahead in x, blended over frames, never past the target
	Receive(2040, 10, -3000, 100);
	int prev = k->posX, moves = 0;
	for (int f = 0; f < 60; f++)
	{
		NativeOnline_Frame();
		EXPECT(k->posX <= 2040 * 256 && k->posX >= prev, "frame %d : x %d (prev %d) overshoots or goes back", f, k->posX, prev);
		if (k->posX != prev)
			moves++;
		prev = k->posX;
	}
	EXPECT(k->posX == 2040 * 256, "near pose not reached : x %d", k->posX >> 8);
	EXPECT(moves >= 3, "near pose applied in %d frame(s), wanted a blend", moves);

	// two packets in one frame : their mean is the target (reordered noise cancels)
	Receive(2050, 10, -3000, 100);
	Receive(2070, 10, -3000, 100);
	for (int f = 0; f < 60; f++)
		NativeOnline_Frame();
	EXPECT(k->posX == 2060 * 256, "two packets in a frame : x %d, wanted their mean 2060", k->posX >> 8);

	// the angle the short way : 4090 → 5 is +11, never -4085
	k->angle = 4090;
	Receive(2060, 10, -3000, 5);
	for (int f = 0; f < 60; f++)
	{
		NativeOnline_Frame();
		EXPECT(k->angle >= 4090 || k->angle <= 5, "frame %d : angle %d went the long way", f, k->angle);
	}
	EXPECT(k->angle == 5, "angle not reached : %d", k->angle);

	// out of the race nothing is left pending
	Receive(2100, 10, -3000, 5);
	stub.octr.CurrState = LOBBY_ASSIGN_ROLE;
	NativeOnline_Frame();
	stub.octr.CurrState = GAME_START_RACE;
	for (int f = 0; f < 10; f++)
		NativeOnline_Frame();
	EXPECT(k->posX == 2060 * 256, "a pose received out of the race was applied : x %d", k->posX >> 8);

	if (failures == 0)
		printf("PASSED: smoothing (snap, blend, mean, angle wrap, reset)\n");
	return failures ? EXIT_FAILURE : EXIT_SUCCESS;
}
