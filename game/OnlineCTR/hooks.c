#include <common.h>
#include "global.h"

int OnlineGetNumDrivers()
{
	return octr->NumDrivers;
}

void StatsUpgrade()
{
	/*
		Stat 9 is acceleration,
		Stats 11 and 12 speed related
	*/
	for (int i = 9; i < 13; i++)
	{
		// ctr-native: the retail table has 4 classes and no MAX column
		// (upstream's value[4]); upstream's MAX is the largest class value
		// for stats 9-12 (544, 1152, 13900, 15400), so take that
		int max = data.metaPhys[i].value[0];
		for (int j = 1; j < NUM_CLASSES; j++)
			if (data.metaPhys[i].value[j] > max)
				max = data.metaPhys[i].value[j];

		for (int j = 0; j < 4; j++)
		{
			data.metaPhys[i].value[j] = max; // copy MAX
		}
	}
}

void octr_entryHook()
{
	void StatsUpgrade(); StatsUpgrade();
	
	// BOTS_Adv_AdjustDifficulty(); must be called before
	// initializing any AI, either BOTS_Driver_Init or
	// from BOTS_Driver_Convert. If AIs are wanted, then
	// put that call in OnlineInit_Drivers, but for now
	// just disable BOTS_Driver_Convert
	#ifndef CTR_NATIVE
	*(int*)0x80017318 = 0x3E00008;
	*(int*)0x8001731c = 0;
	#endif
	// ctr-native: no MIPS to patch, BOTS_Driver_Convert returns early under USE_ONLINE

	// remove cutscene threads
	for(int i = 0x96; i < 0xa6; i++)
	{
		data.MetaDataModels[i].LInB = 0;
	}

	// ======== Globals ============

	#if USE_K1 == 1
	octr = 0x8000C000;
	#endif

	// default for first LEV, before gameplay
	memset(octr, 0, sizeof(struct OnlineCTR));
	octr->IsBootedPS1 = 1;
	octr->ver_psx = VERSION;
	octrActive = 1; // ctr-native: one build — the native boot is the mod's own flow
}

// this runs after the end of MainInit_FinalizeInit,
// which is also after the end of camera initialization
void octr_initHook()
{
	void octr_ThreadFunc(); // ctr-native: ThreadFunc is a typedef

	// small stack pool, pause thread (those threads can't pause)
	PROC_BirthWithObject(0x30f, octr_ThreadFunc, 0, 0);
	octrThreadAlive = 1; // ctr-native: one build (native_bridge.c)

	struct GameTracker* gGT = sdata->gGT;
	if(gGT->levelID <= TURBO_TRACK)
	{
		DECOMP_CAM_StartOfRace(&gGT->cameraDC[0]);
		gGT->gameMode1 |= START_OF_RACE;
		gGT->hudFlags &= ~(1);
	}
}

// replace MainInit_Drivers
void OnlineInit_Drivers(struct GameTracker* gGT)
{
	int i;
	int bitFlag;
	struct Driver* dr;

	// ctr-native: the host's bots (docs/ONLINECTR_PORT.md, D11.4) : the nav
	// data and arcadeDifficulty first, as MainInit_Drivers ; before the spawn
	// order below, which it would overwrite
	if (octrHostBots != 0)
		BOTS_Adv_AdjustDifficulty();

	for(i = 0; i < 8; i++)
	{
		gGT->drivers[i] = 0;
		sdata->kartSpawnOrderArray[i] = i;
	}

	// if first boot
	if(gGT->levelID == CREDITS_POLAR)
	{
		gGT->drivers[0] = VehBirth_Player(0);
		return;
	}

	if(DECOMP_LOAD_IsOpen_RacingOrBattle())
		DECOMP_RB_MinePool_Init();

	// 8 spawn positions
	bitFlag = 7;

	// override for battle maps
	if(
		(gGT->levelID > TURBO_TRACK) &&
		(gGT->levelID < GEM_STONE_VALLEY)
	  )
	{
		// 4 spawn positions
		bitFlag = 3;
	}

	// All clients must spawn drivers in the same order,
	// so that pointers can be sent over network

	int numDead = 0;

	for(i = 0; i < octr->DriverID; i++)
	{
		if(octr->nameBuffer[i+1][0] == 0)
		{
			numDead++;
			continue;
		}

		// init, save
		dr = DECOMP_VehBirth_Player(i+1);
		gGT->drivers[i+1] = dr;

		// fakeID, teleport
		dr->driverID = (i-numDead)&bitFlag;
		DECOMP_VehBirth_TeleportSelf(dr,3,0);

		// realID
		dr->driverID = i+1;
	}

	// init, save
	dr = DECOMP_VehBirth_Player(0);
	gGT->drivers[0] = dr;

	// fakeID, teleport
	dr->driverID = (i-numDead)&bitFlag;
	DECOMP_VehBirth_TeleportSelf(dr,3,0);

	// realID
	dr->driverID = 0;

	for(i = i+1; i < octr->NumDrivers; i++)
	{
		if(octr->nameBuffer[i][0] == 0)
		{
			numDead++;
			continue;
		}

		// ctr-native: a host bot is an AI kart here, a remote kart elsewhere (D11.4)
		if (ONLINE_HOST_BOT(i))
		{
			dr = BOTS_Driver_Init(i);
			if (dr == NULL) { continue; } // no nav path on this track
			memset(&dr->uncappedReserves, 0, sizeof(struct Driver) - offsetof(struct Driver, uncappedReserves));
			dr->bestLapTime = HOURS(10);

			// the start grid without holes, as the players' fakeID below
			dr->driverID = (i-numDead)&bitFlag;
			BOTS_GotoStartingLine(dr);
			dr->driverID = i;
			continue;
		}

		// init, save
		dr = DECOMP_VehBirth_Player(i);
		gGT->drivers[i] = dr;

		// fakeID, teleport
		dr->driverID = (i-numDead)&bitFlag;
		DECOMP_VehBirth_TeleportSelf(dr,3,0);

		// realID
		dr->driverID = i;
	}
	

	// ctr-native: the AI engine sounds, as MainInit_Drivers
	if ((octrHostBots != 0) && (gGT->numBotsNextGame != 0))
	{
		EngineAudio_InitOnce(0x10, HOWL_SFX_CENTER_NO_DISTORTION);
		EngineAudio_InitOnce(0x11, HOWL_SFX_CENTER_NO_DISTORTION);
	}

	if (gGT->levelID != 0x26 /*INTRO_RACE_TODAY*/) //was 0x26 (globe level)
	{
		octr->CurrState = GAME_WAIT_FOR_RACE;
	}
}

bool HasRaceEnded()
{
	int numPlayersDisconnected = 0;
	for (int i = 0; i < octr->NumDrivers; i++)
	{
		if (octr->nameBuffer[i][0] == 0) { numPlayersDisconnected++; }
	}
	return octr->numDriversEnded == (octr->NumDrivers - numPlayersDisconnected);
}

RECT windowText = {0x118, 0x40, 0xD8, 0};

//extern int currCam; //from endOfRaceUI.c

void OnlineEndOfRace()
{
	struct Driver * driver = sdata->gGT->drivers[0];

	// ctr-native: the humans left for the next character select ; a Netplay Cup (D12.4) :
	// counted with the full results, then its standings replace them, through the room's
	// reset until the next track loads
	if ((driver->actionsFlagSet & 0x2000000) != 0)
		OnlineRoom_EndOfRace();
	if (OnlineCup_Showing()) { EndOfRace_Camera(); return; }

	if (((driver->actionsFlagSet & 0x2000000) == 0) ||
		(octr->CurrState < GAME_START_RACE)) { return; }

	//this is a potential untested fix for the "spectator name bug"
	//(i.e.), when first beginning to spectate, the name of the person you're
	//spectating at the bottom of the screen can sometimes be incorrect until you
	//change the camera for the first time.
	//if (octr->CurrState != GAME_END_RACE) //this must be out first frame here.
	//{
	//	currCam = 0;
	//	sdata->gGT->cameraDC[0].driverToFollow = sdata->gGT->drivers[currCam];
	//}

	octr->CurrState = GAME_END_RACE;

	static unsigned frameCounter = 0;
	EndOfRace_Camera();
	EndOfRace_Icons();
	int color = frameCounter++ & FPS_DOUBLE(1) ? RED : WHITE;
	if (HasRaceEnded())
	{
		DecalFont_DrawLine("RACE COMPLETE", 256, 108, FONT_BIG, JUSTIFY_CENTER | color);
	}
}

void Online_OtherFX_RecycleNew(
		u_int* soundID_Count, u_int newSoundID, u_int modifyFlags)
{
	struct Driver* d = sdata->gGT->drivers[0];

	if(
		((int)soundID_Count != (int)&d->driverAudioPtrs[0]) &&
		((int)soundID_Count != (int)&d->driverAudioPtrs[1]) &&
		((int)soundID_Count != (int)&d->driverAudioPtrs[2]) &&
		((int)soundID_Count != (int)&d->driverAudioPtrs[3])
	  )
	{
		// For now, mute everyone who is not Player1.
		// In the future, modify Vol/LR
		return;
	}

	int local = *soundID_Count;

    if (
		// if this sound is already playing
		(local != 0) &&

        // if soundID doesn't match new ID
        ((local & 0xffff) != newSoundID)
	   )
    {
        OtherFX_Stop1(local);

		*soundID_Count = 0;
		local = 0;
    }

    if (newSoundID != ((u_int)-1))
    {
        // if this is a new sound
        if (local == 0)
        {
            *soundID_Count =
				OtherFX_Play_LowLevel(newSoundID & 0xffff, 0, modifyFlags);
        }
        // if not a new sound,
        // modification of old sound
        else
        {
            OtherFX_Modify((u_int)local, modifyFlags);
        }
    }
}
