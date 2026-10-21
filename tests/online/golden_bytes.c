// A1 — wire format: every CG_* / SG_* struct of upstream global.h, packed
// with known field values, against bytes derived by hand from the protocol
// (little-endian, bitfields LSB-first within each byte, natural alignment).
// Bitfield layout is the one compiler-defined part of the wire format:
// this runs with GCC natively and with Emscripten's clang under node.

#include <stdio.h>
#include <string.h>

#define WINDOWS_INCLUDE
#ifndef GLOBAL_H
#define GLOBAL_H "../../game/OnlineCTR/global.h"
#endif
#include GLOBAL_H

static int failures;

static void Check(const char *what, const void *msg, size_t size, const unsigned char *expected, size_t expectedSize)
{
	const unsigned char *bytes = (const unsigned char *)msg;

	if (size != expectedSize || memcmp(bytes, expected, size) != 0)
	{
		failures++;
		printf("FAIL %-24s got", what);
		for (size_t i = 0; i < size; i++) printf(" %02x", bytes[i]);
		printf("  expected");
		for (size_t i = 0; i < expectedSize; i++) printf(" %02x", expected[i]);
		printf("\n");
		return;
	}
	printf("ok   %-24s %zu B\n", what, size);
}

#define CHECK(name, msg, ...) do { \
	static const unsigned char e[] = { __VA_ARGS__ }; \
	Check(name, &(msg), sizeof(msg), e, sizeof(e)); \
} while (0)

int main(void)
{
	// ===== client -> server =====
	{
		struct CG_Header m; memset(&m, 0, sizeof(m));
		m.type = CG_STARTRACE; m.padding = 0xA;
		CHECK("CG_Header", m, 0xA4);
	}
	{
		struct CG_MessageRoom m; memset(&m, 0, sizeof(m));
		m.type = CG_JOINROOM; m.room = 0xFF;
		CHECK("CG_MessageRoom", m, 0x00, 0xFF);
	}
	{
		struct CG_MessageName m; memset(&m, 0, sizeof(m));
		m.type = CG_NAME; memcpy(m.name, "ABCDEFGHI", 10);
		CHECK("CG_MessageName", m, 0x01, 'A','B','C','D','E','F','G','H','I', 0x00);
	}
	{
		struct CG_MessageTrack m; memset(&m, 0, sizeof(m));
		m.type = CG_TRACK; m.trackID = 0x13; m.lapID = 5;
		// byte1 = trackID (bits 0-4) | lapID << 5 = 0x13 | 0xA0
		CHECK("CG_MessageTrack", m, 0x02, 0xB3);
	}
	{
		struct CG_MessageCharacter m; memset(&m, 0, sizeof(m));
		m.type = CG_CHARACTER; m.characterID = 0xA; m.boolLockedIn = 1;
		CHECK("CG_MessageCharacter", m, 0xA3, 0x01);
	}
	{
		struct CG_EverythingKart m; memset(&m, 0, sizeof(m));
		m.type = CG_RACEDATA; m.wumpa = 5; m.boolReserves = 1;
		m.kartRot1 = 0x1F; m.kartRot2 = 0x7F; m.buttonHold = 0xC5;
		m.posX = 0x1234; m.posY = -2; m.posZ = 0x7FFF;
		// byte0 = 5 | 5 << 4 | 1 << 7
		CHECK("CG_EverythingKart", m, 0xD5, 0x1F, 0x7F, 0xC5, 0x34, 0x12, 0xFE, 0xFF, 0xFF, 0x7F);
	}
	{
		struct CG_MessageWeapon m; memset(&m, 0, sizeof(m));
		m.type = CG_WEAPON; m.juiced = 1; m.flags = 2; m.weapon = 0xB;
		// byte0 = 6 | juiced << 4 | flags << 6 ; byte1 = weapon
		CHECK("CG_MessageWeapon", m, 0x96, 0x0B);
	}
	{
		struct CG_MessageEndRace m; memset(&m, 0, sizeof(m));
		m.type = CG_ENDRACE; m.courseTime = 0x01020304; m.lapTime = 0x0A0B0C0D;
		CHECK("CG_MessageEndRace", m, 0x07, 0, 0, 0, 0x04, 0x03, 0x02, 0x01, 0x0D, 0x0C, 0x0B, 0x0A);
	}

	// ===== server -> client =====
	{
		struct SG_Header m; memset(&m, 0, sizeof(m));
		m.type = SG_STARTLOADING;
		CHECK("SG_Header", m, 0x05);
	}
	{
		struct SG_MessageRooms m; memset(&m, 0, sizeof(m));
		m.type = SG_ROOMS; m.numRooms = 16; m.version = VERSION;
		m.numClients01 = 1; m.numClients02 = 2; m.numClients03 = 3; m.numClients04 = 4;
		m.numClients05 = 5; m.numClients06 = 6; m.numClients07 = 7; m.numClients08 = 8;
		m.numClients09 = 9; m.numClients10 = 10; m.numClients11 = 11; m.numClients12 = 12;
		m.numClients13 = 13; m.numClients14 = 14; m.numClients15 = 15; m.numClients16 = 0;
		// VERSION 1021 = 0x03FD
		CHECK("SG_MessageRooms", m, 0x00, 0x10, 0xFD, 0x03, 0x21, 0x43, 0x65, 0x87, 0xA9, 0xCB, 0xED, 0x0F);
	}
	{
		struct SG_MessageClientStatus m; memset(&m, 0, sizeof(m));
		m.type = SG_NEWCLIENT; m.clientID = 7; m.numClientsTotal = 8; m.special = 3;
		CHECK("SG_MessageClientStatus", m, 0x71, 0x38);
	}
	{
		struct SG_MessageName m; memset(&m, 0, sizeof(m));
		m.type = SG_NAME; m.clientID = 6; m.numClientsTotal = 7; memcpy(m.name, "xyz", 4);
		CHECK("SG_MessageName", m, 0x02, 0x76, 'x', 'y', 'z', 0, 0, 0, 0, 0, 0, 0);
	}
	{
		struct SG_MessageTrack m; memset(&m, 0, sizeof(m));
		m.type = SG_TRACK; m.trackID = 0x1F; m.lapID = 7;
		CHECK("SG_MessageTrack", m, 0x03, 0xFF);
	}
	{
		struct SG_MessageCharacter m; memset(&m, 0, sizeof(m));
		m.type = SG_CHARACTER; m.clientID = 5; m.boolLockedIn = 1; m.characterID = 0xE;
		// byte0 = 4 | 5 << 4 | 1 << 7 ; byte1 = 0xE
		CHECK("SG_MessageCharacter", m, 0xD4, 0x0E);
	}
	{
		struct SG_EverythingKart m; memset(&m, 0, sizeof(m));
		m.type = SG_RACEDATA; m.wumpa = 2; m.boolReserves = 0;
		m.clientID = 6; m.kartRot1 = 0x15; m.kartRot2 = 0x80; m.buttonHold = 0x3C;
		m.posX = -1; m.posY = 0x0102; m.posZ = -32768;
		// byte0 = 7 | 2 << 4 ; byte1 = 6 | 0x15 << 3
		CHECK("SG_EverythingKart", m, 0x27, 0xAE, 0x80, 0x3C, 0xFF, 0xFF, 0x02, 0x01, 0x00, 0x80);
	}
	{
		struct SG_MessageWeapon m; memset(&m, 0, sizeof(m));
		m.type = SG_WEAPON; m.clientID = 3; m.juiced = 1; m.weapon = 9; m.flags = 3;
		// byte0 = 8 | 3 << 4 | 1 << 7 ; byte1 = 9 | 3 << 4
		CHECK("SG_MessageWeapon", m, 0xB8, 0x39);
	}
	{
		struct SG_MessageEndRace m; memset(&m, 0, sizeof(m));
		m.type = SG_ENDRACE; m.clientID = 4; m.courseTime = -1; m.lapTime = 0x00E100;
		CHECK("SG_MessageEndRace", m, 0x49, 0, 0, 0, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0xE1, 0x00, 0x00);
	}

	// enum values are the wire type codes
	if (CG_ENDRACE != 7 || SG_ENDRACE != 9 || SG_SERVERCLOSED != 10 || VERSION != 1021)
	{
		failures++;
		printf("FAIL enum values / VERSION\n");
	}

	printf("%s: %d failure(s)\n", failures ? "FAILED" : "PASSED", failures);
	return failures ? 1 : 0;
}
