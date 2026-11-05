#ifndef STUB_GAME_H
#define STUB_GAME_H

#define WINDOWS_INCLUDE
#include "../../game/OnlineCTR/global.h"
#include "../../platform/native_online_game.h"

// Stand-in for the game behind native_online_game.h: the fields the client
// bridge reads and writes, plus the few octr transitions the game side
// (states.c, thread.c, hooks.c) makes, driven by the test script.

struct StubPad
{
	int held, tapped, released, prev;
	int stickLX, stickLY;
};

struct StubGame
{
	struct OnlineCTR octr;
	int levelID;
	int loadingStage;
	int gameMode1;
	int gameMode2;
	int numLaps;
	int characterIDs[8];
	struct StubPad pads[8];
	struct NativeOnlineKart karts[8];
	int kartExists[8];

	// the host's bots (session 23) : the track lock's mode, the menus'
	// characters, the slots the host's AI drives, finish flags, a pending shot
	int lobbyBots;
	int lobbyCharacters[4];
	int hostBots;
	int kartFinished[8];
	int raceClock;
	int botShot[8];
	int takenOver[8];
	int botEndTime[8]; // session 32c : the estimate EndBots gave a bot, 0 : none
	int skipReset;     // session 32d : the host's Cross asked the server's reset now (once)

	// a guest finishing alone (session 32) : no AI in Battle, the title reloads
	int noAI;
	int deactivated;

	// script inputs for the local player
	int localHeld;
	int loadFrames;
	int flyInFrames;
};

extern struct StubGame stub;

void StubGame_Boot(void);

// once per frame, after NativeOnline_Frame()
void StubGame_Frame(void);

#endif
