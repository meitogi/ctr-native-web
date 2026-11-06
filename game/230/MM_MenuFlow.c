#include <common.h>

s32 MM_TransitionInOut(struct TransitionMeta *meta, s32 framesPassed, s32 numFrames)
{
	s16 negativeTransitionState;
	s16 allTransitionsDone;
	u16 transitionIndex;
	s32 transitionFrame;
	s16 start;
	s16 framesLeft;

	allTransitionsDone = 1;
	negativeTransitionState = 0;
	transitionIndex = 0;
	start = meta->headStart;
	transitionFrame = framesPassed;

	// last member of array is null-terminated with 0xFFFF
	for (/**/; start > -1; meta++, transitionIndex++, start = meta->headStart)
	{
		framesLeft = (s16)transitionFrame - start;

		if ((framesLeft == MM_TRANSITION_SWISH_FRAME) && (transitionIndex == 0))
		{
			// Play "swoosh" sound for menu transition
			OtherFX_Play(MM_TRANSITION_SWISH_SFX, 0);
		}

		if (framesLeft < 1)
		{
			allTransitionsDone = 0;
			meta->currX = 0;
			meta->currY = 0;
		}
		else if (framesLeft >= (s16)numFrames)
		{
			negativeTransitionState = 0;
			meta->currX = meta->distX;
			meta->currY = meta->distY;
		}
		else
		{
			allTransitionsDone = 0;
			negativeTransitionState = allTransitionsDone;
			meta->currX = framesLeft * meta->distX / (s16)numFrames;
			meta->currY = framesLeft * meta->distY / (s16)numFrames;
		}
	}
	return allTransitionsDone ? 1 : (negativeTransitionState ? -1 : 0);
}

#ifdef USE_ONLINE
#include <platform/native_web_ui.h>
// ctr-native: one build — the main menu's ONLINE row and its VS / BATTLE /
// ARCADE sub-menu. Without a room the row has the page host one ; with one, VS and
// BATTLE take the retail paths (characters, track) with the room's players as P2-P4,
// their count the room's humans (no players menu, session 32b), and the track lock
// starts the room's race (QueueLoadTrack.c). The native build boots into the mod's own menus and
// never shows this row.
static struct MenuRow onlineRowsMainBasic[8] =
{
	{0x4C, 0, 1, 0, 0},
	{0x4D, 0, 2, 1, 1},
	{0x4E, 1, 3, 2, 2},
	{0x4F, 2, 4, 3, 3},
	{0x50, 3, 5, 4, 4},
	{ONLINE_LNG_ROW, 4, 6, 5, 5},
	{0x51, 5, 6, 6, 6},
	{RECTMENU_STRING_NONE},
};
static struct MenuRow onlineRowsMainWithScrapbook[9] =
{
	{0x4C, 0, 1, 0, 0},
	{0x4D, 0, 2, 1, 1},
	{0x4E, 1, 3, 2, 2},
	{0x4F, 2, 4, 3, 3},
	{0x50, 3, 5, 4, 4},
	{ONLINE_LNG_ROW, 4, 6, 5, 5},
	{0x51, 5, 7, 6, 6},
	{0x234, 6, 7, 7, 7},
	{RECTMENU_STRING_NONE},
};
// NETPLAY's row in both main menus above
#define ONLINE_MAIN_ROW 5
static struct MenuRow onlineRowsModes[4] =
{
	{0x4F, 0, 1, 0, 0},
	{0x50, 0, 2, 1, 1},
	{LNG_ARCADE, 1, 2, 2, 2},
	{RECTMENU_STRING_NONE},
};
static void OnlineMenu_Proc(struct RectMenu *menu);
static struct RectMenu onlineMenu =
{
	.stringIndexTitle = ONLINE_LNG_ROW,
	.state = CENTER_ON_X,
	.rows = &onlineRowsModes[0],
	.funcPtr = OnlineMenu_Proc,
};

// ONLINE > ARCADE (docs/ONLINECTR_PORT.md, D11.8) : the retail Arcade path with
// the room's humans as P1-P4 and the host's bots filling up to 8 karts. Its own
// race type (single race, the Cup : D12), then the retail difficulty : solo Arcade
// keeps D230's 1P / 2P and its Cup.
static struct MenuRow onlineRowsRaceType[3] =
{
	{0x15E, 0, 1, 0, 0},
	{0x15F, 0, 1, 1, 1},
	{RECTMENU_STRING_NONE},
};
static void OnlineArcadeRaceType_Proc(struct RectMenu *menu);
static struct RectMenu onlineMenuRaceType =
{
	.stringIndexTitle = LNG_RACE_TYPE,
	.state = CENTER_ON_X,
	.rows = &onlineRowsRaceType[0],
	.funcPtr = OnlineArcadeRaceType_Proc,
};

// NETPLAY with no room (session 32) : the page hosts one at once with its saved relay and key,
// and the ONLINE menu opens once it is on (MM_MenuProc_Main) ; without them this box says why
// and offers the page's Netplay settings. Its strings take language slots the mod's own
// menus use on native only (ONLINE_LNG_ROW's neighbours).
#define ONLINE_LNG_NO_KEY 0x9b
#define ONLINE_LNG_OPEN_SETTINGS 0x9c
#define ONLINE_LNG_BACK 0x9d
// frames left for the room NETPLAY asked for to come on (a refused host never opens the menu later)
#define ONLINE_AUTO_OPEN_FRAMES 1800
static int onlineAutoOpen;
static struct MenuRow onlineRowsNoKey[3] =
{
	{ONLINE_LNG_OPEN_SETTINGS, 0, 1, 0, 0},
	{ONLINE_LNG_BACK, 0, 1, 1, 1},
	{RECTMENU_STRING_NONE},
};
static void OnlineNoKey_Proc(struct RectMenu *menu);
static struct RectMenu onlineMenuNoKey =
{
	.stringIndexTitle = ONLINE_LNG_NO_KEY,
	.state = CENTER_ON_X,
	.rows = &onlineRowsNoKey[0],
	.funcPtr = OnlineNoKey_Proc,
};

// Cross on OPEN : the page's panel ; BACK, Triangle or Circle : the main menu
static void OnlineNoKey_Proc(struct RectMenu *menu)
{
	s16 row = menu->rowSelected;

	if (row < -1 || row > 1)
		return;
	if ((row == 0) && ((sdata->gGamepads->gamepad[0].buttonsTapped & BTN_CIRCLE) == 0))
		NativeWeb_OpenMultiplayer();
	menu->ptrPrevBox_InHierarchy->state &= ~(ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY);
}

// The room's humans, one per machine : the host and its guests (P2-P4, held while the host's
// menus run). On the web, the guests' slots only : a second pad on the host's machine is no guest.
static int OnlineRoom_Humans(void)
{
	int n = 1;

#if defined(__EMSCRIPTEN__)
	while ((n < 4) && (NativeWeb_RoomGuestMask() & (1 << n)))
		n++;
#else
	while ((n < 4) && MainFrame_HaveAllPads(n + 1))
		n++;
#endif
	return n;
}

// as MM_ToggleRows_PlayerCount : VS and BATTLE need a second human, ARCADE has its bots
static void OnlineMenu_ToggleModeRows(void)
{
	int alone = OnlineRoom_Humans() < 2;

	for (int i = 0; i < 2; i++)
	{
		onlineRowsModes[i].stringIndex &= MENU_ROW_LNG_MASK;
		if (alone)
			onlineRowsModes[i].stringIndex |= MENU_ROW_LOCKED;
	}
}

// The ONLINE menu and every box below it closed (32e) : the select's Triangle jumps back to the
// ONLINE menu over them, and a box left drawing its next one or only its title opened that whole
// chain again at the next ARCADE or VS, the difficulty frozen as a title.
static void OnlineMenus_Fold(void)
{
	struct RectMenu *menus[] = {&onlineMenu, &onlineMenuRaceType, &MM_MENU_RACE_TYPE, &MM_MENU_DIFFICULTY,
	                            &MM_MENU_PLAYERS_1P2P, &MM_MENU_PLAYERS_2P3P4P};

	for (int i = 0; i < (int)(sizeof(menus) / sizeof(menus[0])); i++)
		menus[i]->state &= ~(ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY);
}

// Back on the main menu after a room (the user, 32e) : the menus as at boot, the save and P1's
// character kept. D230 is never reloaded here, so its cursors, the select's locks and the backups
// outlive every room ; P2-P4 back on the boot's characters (a guest who joins later is moved off a
// taken one by MM_Characters_PreventOverlap).
static void OnlineMenus_Fresh(void)
{
	struct RectMenu *menus[] = {&onlineMenu, &onlineMenuRaceType, &onlineMenuNoKey, &MM_MENU_RACE_TYPE, &MM_MENU_DIFFICULTY,
	                            &MM_MENU_PLAYERS_1P2P, &MM_MENU_PLAYERS_2P3P4P, &MM_MENU_CUP_SELECT, &MM_MENU_TRACK_SELECT};

	GAME_TRACKER->gameMode1 &= ~(BATTLE_MODE | ADVENTURE_MODE | TIME_TRIAL | ADVENTURE_ARENA | ARCADE_MODE | ADVENTURE_CUP);
	GAME_TRACKER->gameMode2 &= ~(CUP_ANY_KIND);
	GAME_TRACKER->numLaps = MM_DEFAULT_LAP_COUNT;
	GAME_TRACKER->numPlyrNextGame = 1;
	GAME_TRACKER->cup.cupID = 0;
	for (int i = 0; i < (int)(sizeof(menus) / sizeof(menus[0])); i++)
		menus[i]->rowSelected = 0;
	MM_TRACK_SEL_BACKUP = 0;
	MM_CHARACTER_SELECT_FLAGS = 0;
	MM_CHARACTER_SELECT_TRANSITION_STATE = ENTERING_MENU;
	for (int p = 1; p < 4; p++)
	{
		GAME_CHARACTER_IDS[p] = p;
		MM_CHARACTER_IDS_BACKUP[p] = p;
	}
	OnlineMenus_Fold();
	octrOnlineArcade = 0;
	octrSlotGone = 0;
	onlineAutoOpen = 0;
}

// No players menu in a room (session 32b) : the room's humans, then the character select,
// as MM_MenuProc_2p3p4p's exit
static void OnlineMenu_ToCharacters(struct RectMenu *menu)
{
	GAME_TRACKER->numPlyrNextGame = OnlineRoom_Humans();
	MM_TITLE_MENU_STATE = TITLE_MENU_STATE_EXITING;
	MM_DESIRED_MENU_INDEX = MM_EXIT_ROUTE_CHARACTER_SELECT;
	menu->state = (menu->state & ~DRAW_NEXT_MENU_IN_HIERARCHY) | ONLY_DRAW_TITLE;
}

// as MM_MenuProc_SingleCup's Arcade branch
static void OnlineArcadeRaceType_Proc(struct RectMenu *menu)
{
	s16 row = menu->rowSelected;

	if (row == -1)
	{
		menu->ptrPrevBox_InHierarchy->state &= ~(ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY);
		return;
	}
	if (row < 0 || row > 1)
		return;

	GAME_TRACKER->gameMode2 &= ~(CUP_ANY_KIND);
	if (row == 1)
		GAME_TRACKER->gameMode2 |= CUP_ANY_KIND;
	menu->state |= ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY;
	menu->ptrNextBox_InHierarchy = &MM_MENU_DIFFICULTY;
	MM_CHARACTER_SELECT_TRANSITION_STATE = IN_MENU;
}

static void OnlineMenu_Proc(struct RectMenu *menu)
{
	s16 row = menu->rowSelected;

	if (row == -1)
	{
		menu->ptrPrevBox_InHierarchy->state &= ~(ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY);
		return;
	}
	if (row < -1 || row > 2 || !ONLINE_ROOM)
	{
		return;
	}

	// as the main menu's VS / BATTLE rows ; an ARCADE or a BATTLE taken then backed out of
	// (the character select's Triangle comes back here, not through the main menu) leaves
	// nothing behind
	GAME_TRACKER->gameMode2 &= ~(CUP_ANY_KIND);
	GAME_TRACKER->gameMode1 &= ~(ARCADE_MODE | BATTLE_MODE);
	octrOnlineArcade = 0;
	if (row == 2)
	{
		// as the main menu's ARCADE row, then the online race type
		if ((GAME_TRACKER->gameMode2 & CHEAT_ONELAP) != 0)
		{
			GAME_TRACKER->numLaps = MM_ONE_LAP_CHEAT_COUNT;
		}
		GAME_TRACKER->gameMode1 |= ARCADE_MODE;
		octrOnlineMenuPath = 1;
		octrOnlineArcade = 1;
		menu->state |= ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY;
		menu->ptrNextBox_InHierarchy = &onlineMenuRaceType;
		return;
	}
	if (row == 0)
	{
		if ((GAME_TRACKER->gameMode2 & CHEAT_ONELAP) != 0)
		{
			GAME_TRACKER->numLaps = MM_ONE_LAP_CHEAT_COUNT;
		}
		// VS : the retail race type, single race or Cup (D12.6), then the characters
		octrOnlineMenuPath = 1;
		menu->state |= ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY;
		menu->ptrNextBox_InHierarchy = &MM_MENU_RACE_TYPE;
		return;
	}

	// BATTLE : the characters at once, then the retail arena and setup
	GAME_TRACKER->gameMode1 |= BATTLE_MODE;
	octrOnlineMenuPath = 1;
	OnlineMenu_ToCharacters(menu);
}
#endif

void MM_MenuProc_Main(struct RectMenu *menu)
{
	register u32 timeTrialSetupTracker CTR_PSX_REGISTER("$3");
	register struct RectMenu *mainMenu CTR_PSX_REGISTER("$16");
	struct Title *titleObj;
	s16 choose;

	mainMenu = menu;

	// if scrapbook is unlocked, change "rows" to extended array
	if ((MM_GAME_UNLOCKS[MEMCARD_BIT_WORD(GAME_UNLOCK_BIT_SCRAPBOOK)] & MEMCARD_BIT_MASK(GAME_UNLOCK_BIT_SCRAPBOOK)) != 0)
	{
		MM_MENU_MAIN.rows = MM_ROWS_MAIN_WITH_SCRAPBOOK;
	}
#ifdef USE_ONLINE
	if (!octrBootOnline) // ctr-native: one build, runtime
	{
		GAME_LANGUAGE_STRINGS[ONLINE_LNG_ROW] = "NETPLAY";
		GAME_LANGUAGE_STRINGS[ONLINE_LNG_NO_KEY] = "NO RELAY KEY";
		GAME_LANGUAGE_STRINGS[ONLINE_LNG_OPEN_SETTINGS] = "OPEN NETPLAY SETTINGS";
		GAME_LANGUAGE_STRINGS[ONLINE_LNG_BACK] = "BACK";
		MM_MENU_MAIN.rows = (MM_MENU_MAIN.rows == MM_ROWS_MAIN_WITH_SCRAPBOOK) ? onlineRowsMainWithScrapbook : onlineRowsMainBasic;
		onlineMenu.posX_curr = MM_MENU_RACE_TYPE.posX_curr;
		onlineMenu.posY_curr = MM_MENU_RACE_TYPE.posY_curr;
		onlineMenuRaceType.posX_curr = MM_MENU_RACE_TYPE.posX_curr;
		onlineMenuRaceType.posY_curr = MM_MENU_RACE_TYPE.posY_curr;
		onlineMenuNoKey.posX_curr = MM_MENU_RACE_TYPE.posX_curr;
		onlineMenuNoKey.posY_curr = MM_MENU_RACE_TYPE.posY_curr;
		OnlineMenu_ToggleModeRows();
		// the room NETPLAY asked for is on : its menu, as the row would open it
		if (onlineAutoOpen && !ONLINE_ROOM)
			onlineAutoOpen--;
		if (onlineAutoOpen && ONLINE_ROOM && ((mainMenu->state & DRAW_NEXT_MENU_IN_HIERARCHY) == 0))
		{
			onlineAutoOpen = 0;
			octrFreshMenu = 1;
			mainMenu->ptrNextBox_InHierarchy = &onlineMenu;
			mainMenu->state |= ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY;
		}
	}
#endif

	MM_ParseCheatCodes();
	MM_ToggleRows_Difficulty();
	MM_ToggleRows_PlayerCount();

	// If you are at the highest hierarchy level of main menu
	if (mainMenu->funcState == RECTMENU_FUNC_STATE_UPDATE)
	{
		MM_Title_MenuUpdate();

		if (
		    // main menu, "title" exists, and timer >= 230
		    (MM_TITLE_MENU_STATE == TITLE_MENU_STATE_IN_MENU) && (MM_TITLE_OBJECT != NULL) && (TITLE_INTRO_TM_DRAW_MIN_FRAME < (s16)MM_TITLE_INTRO_FRAME))
		{
			DecalFont_DrawLineOT(GAME_LANGUAGE_STRINGS[LNG_TM], MM_TITLE_TM_X, MM_TITLE_TM_Y, FONT_SMALL, ORANGE,
			                     &GAME_TRACKER->backBuffer->otMem.uiOT[MM_TITLE_TM_OT_INDEX]);
#if defined(USE_ONLINE) && defined(CTR_WEB_VERSION)
			// ctr-native web: the version (git describe, web/build-web.sh), bottom right
			DecalFont_DrawLine((char *)CTR_WEB_VERSION, 0x1f6, 0xcc, FONT_SMALL, JUSTIFY_RIGHT | GRAY);
#endif
		}

		if ((MM_MENU_MAIN.state & DRAW_NEXT_MENU_IN_HIERARCHY) == 0)
		{
			GAME_TRACKER->numPlyrNextGame = 1;

#ifdef USE_ONLINE
			// ctr-native: one build — a room never starts the attract demo
			octrOnlineMenuPath = 0;
			octrOnlineArcade = 0;
			// back here after a room (the pause menu's QUIT, Triangle up, the page's Leave) : out
			// of it, the menus new ; a guest resting here in its room's lobby stays
			if (octrFreshMenu && !onlineAutoOpen && (!ONLINE_ROOM || (octr->DriverID == 0)))
			{
				octrFreshMenu = 0;
				NativeWeb_LeaveRoom();
				OnlineMenus_Fresh();
			}
			if (ONLINE_ROOM)
				GAME_TRACKER->demoCountdownTimer = TITLE_DEMO_IDLE_FRAMES;
#endif
			// if button pressed, reset timer
			if (GAMEPADS->anyoneHeldCurr != 0)
			{
				GAME_TRACKER->demoCountdownTimer = TITLE_DEMO_IDLE_FRAMES;
			}

			// if no buttons pressed, check demo mode
			else
			{
				GAME_TRACKER->demoCountdownTimer--;

				// If time runs out
				if (GAME_TRACKER->demoCountdownTimer < 1)
				{
					// Transition out of main menu
					MM_TITLE_MENU_STATE = TITLE_MENU_STATE_EXITING;

					// Go to a cutscene of some kind, either the Oxide intro
					// or a demo-mode race.
					MM_DESIRED_MENU_INDEX = MM_EXIT_ROUTE_DEMO;
				}
			}
		}
	}

	MM_Title_Init();

	// if drawing ptrNextBox_InHierarchy
	if ((mainMenu->state & DRAW_NEXT_MENU_IN_HIERARCHY) != 0)
	{
		MM_TITLE_INTRO_FRAME = TITLE_INTRO_SKIP_FRAME;
	}

	// if funcPtr is null
	if ((mainMenu->state & EXECUTE_FUNCPTR) == 0)
	{
		return;
	}

	titleObj = MM_TITLE_OBJECT;

	// if "title" object exists
	if (titleObj != NULL)
	{
		// CameraPosOffset X
		titleObj->cameraPosOffset.x = 0;
	}

	// if you are at highest level of menu hierarchy
	if (mainMenu->funcState != RECTMENU_FUNC_STATE_INPUT)
	{
		// leave the function
		return;
	}

	// If you are here, then you must not be
	// at the highest level of menu hierarchy

	// if row is negative, do nothing
	if (mainMenu->rowSelected < 0)
	{
		return;
	}
	// clear flags from game mode
	GAME_TRACKER->gameMode1 &= ~(BATTLE_MODE | ADVENTURE_MODE | TIME_TRIAL | ADVENTURE_ARENA | ARCADE_MODE | ADVENTURE_CUP);

	// clear more game mode flags
	GAME_TRACKER->gameMode2 &= ~(CUP_ANY_KIND);

	mainMenu->state |= ONLY_DRAW_TITLE;
#ifdef USE_ONLINE
	// the ONLINE menu opens by itself only right after NETPLAY (below)
	onlineAutoOpen = 0;
#endif

	// Default to 3,
	// this intentionally disables the 1-lap cheat
	// in Time Trial and Adventure, DONT change it
	GAME_TRACKER->numLaps = MM_DEFAULT_LAP_COUNT;

	// get LNG index of row selected
	choose = mainMenu->rows[mainMenu->rowSelected].stringIndex;

	switch (choose)
	{
	// Adventure Mode
	case LNG_ADVENTURE:
	{
		struct GameTracker *adventureTracker;

		adventureTracker = GAME_TRACKER;

		// Turn on Adventure Mode
		adventureTracker->gameMode1 |= ADVENTURE_MODE;

		// menu for new/load
		mainMenu->ptrNextBox_InHierarchy = &MM_MENU_ADVENTURE;
		mainMenu->state |= DRAW_NEXT_MENU_IN_HIERARCHY;

		// Turn off item cheats
		adventureTracker->gameMode2 &= ~CHEAT_WUMPA;
		adventureTracker->gameMode2 &= ~CHEAT_TURBO;
		adventureTracker->gameMode2 &= ~CHEAT_MASK;
		adventureTracker->gameMode2 &= ~CHEAT_ENGINE;
		adventureTracker->gameMode2 &= ~CHEAT_BOMBS;
		return;
	}

	// Time Trial
	case LNG_TIME_TRIAL:
		timeTrialSetupTracker = (u32)GAME_TRACKER;
		{
			// Leave main menu hierarchy
			MM_TITLE_MENU_STATE = TITLE_MENU_STATE_EXITING;

			// Leave through the normal character-select flow.
			MM_DESIRED_MENU_INDEX = MM_EXIT_ROUTE_CHARACTER_SELECT;

			// set game mode to Time Trial Mode
			((struct GameTracker *)timeTrialSetupTracker)->numPlyrNextGame = 1;
			((struct GameTracker *)timeTrialSetupTracker)->gameMode1 |= TIME_TRIAL;
			GAME_TRACKER->gameMode2 &= ~CHEAT_WUMPA;
			GAME_TRACKER->gameMode2 &= ~CHEAT_TURBO;
			GAME_TRACKER->gameMode2 &= ~CHEAT_MASK;
			GAME_TRACKER->gameMode2 &= ~CHEAT_ENGINE;
			GAME_TRACKER->gameMode2 &= ~CHEAT_BOMBS;

			return;
		}

	// Arcade Mode
	case LNG_ARCADE:
	{
		// DONT change, should only work in Arcade, and VS
		if ((GAME_TRACKER->gameMode2 & CHEAT_ONELAP) != 0)
		{
			GAME_TRACKER->numLaps = MM_ONE_LAP_CHEAT_COUNT;
		}

		// set game mode to Arcade Mode
		GAME_TRACKER->gameMode1 |= ARCADE_MODE;

		// set next menu
		mainMenu->ptrNextBox_InHierarchy = &MM_MENU_RACE_TYPE;
		mainMenu->state |= DRAW_NEXT_MENU_IN_HIERARCHY;
		return;
	}

	// Versus
	case LNG_VS:
	{
		// DONT change, should only work in Arcade, and VS
		if ((GAME_TRACKER->gameMode2 & CHEAT_ONELAP) != 0)
		{
			GAME_TRACKER->numLaps = MM_ONE_LAP_CHEAT_COUNT;
		}

		// next menu is choosing single+cup
		mainMenu->ptrNextBox_InHierarchy = &MM_MENU_RACE_TYPE;
		mainMenu->state |= DRAW_NEXT_MENU_IN_HIERARCHY;
		return;
	}

#ifdef USE_ONLINE
	// ctr-native: one build — Online
	case ONLINE_LNG_ROW:
	{
		if (!ONLINE_ROOM)
		{
			// no room yet : the page hosts one (its menu opens once it is on), and the
			// main menu stays whole meanwhile ; no relay key saved : the box says why
			if (NativeWeb_NetplayHost())
			{
				onlineAutoOpen = ONLINE_AUTO_OPEN_FRAMES;
				mainMenu->state &= ~ONLY_DRAW_TITLE;
				return;
			}
			mainMenu->ptrNextBox_InHierarchy = &onlineMenuNoKey;
			mainMenu->state |= DRAW_NEXT_MENU_IN_HIERARCHY;
			return;
		}
		octrFreshMenu = 1;
		mainMenu->ptrNextBox_InHierarchy = &onlineMenu;
		mainMenu->state |= DRAW_NEXT_MENU_IN_HIERARCHY;
		return;
	}
#endif

	// Battle
	case LNG_BATTLE:
	{
		MM_CHARACTER_SELECT_TRANSITION_STATE = EXITING_MENU;

		// set game mode to Battle Mode
		GAME_TRACKER->gameMode1 |= BATTLE_MODE;

		// set next menu to 2P,3P,4P
		mainMenu->ptrNextBox_InHierarchy = &MM_MENU_PLAYERS_2P3P4P;
		mainMenu->state |= DRAW_NEXT_MENU_IN_HIERARCHY;
		return;
	}
		CTR_PSX_CLOBBER("$7");

	// High Score
	case LNG_HIGH_SCORE:
		// Leave main menu hierarchy
		MM_TITLE_MENU_STATE = TITLE_MENU_STATE_EXITING;

		// Set next stage to high score menu
		MM_DESIRED_MENU_INDEX = MM_EXIT_ROUTE_HIGH_SCORE;
		return;

	// Scrapbook
	case LNG_SCRAPBOOK:
		// Leave main menu hierarchy
		MM_TITLE_MENU_STATE = TITLE_MENU_STATE_EXITING;

		// Set next stage to Scrapbook
		MM_DESIRED_MENU_INDEX = MM_EXIT_ROUTE_SCRAPBOOK;
		return;

	default:
		return;
	}
}

void MM_ToggleRows_PlayerCount(void)
{
	struct MenuRow *row;
	s16 rowIndex;

	for (rowIndex = 0; rowIndex < MM_PLAYER_1P2P_SELECTABLE_ROWS; rowIndex++)
	{
		row = &MM_ROWS_PLAYERS_1P2P[rowIndex];

		// unlock row
		row->stringIndex &= MENU_ROW_LNG_MASK;

		if ((s16)MainFrame_HaveAllPads(rowIndex + 1) == 0)
		{
			// lock row
			row->stringIndex |= MENU_ROW_LOCKED;
		}
	}

	for (rowIndex = 0; rowIndex < MM_PLAYER_2P3P4P_SELECTABLE_ROWS; rowIndex++)
	{
		row = &MM_ROWS_PLAYERS_2P3P4P[rowIndex];

		// unlock row
		row->stringIndex &= MENU_ROW_LNG_MASK;

		if ((s16)MainFrame_HaveAllPads(rowIndex + 2) == 0)
		{
			// lock row
			row->stringIndex |= MENU_ROW_LOCKED;
		}
	}
}

void MM_MenuProc_1p2p(struct RectMenu *menu)
{
	struct RectMenu *previousMenuOwner;
	s16 row;

	previousMenuOwner = menu;
	row = menu->rowSelected;

	// if uninitialized
	if (row == -1)
	{
		goto UNINITIALIZED;
	}

	if (row < -1)
	{
		return;
	}

	// if on row 0 or 1
	if (row >= MM_PLAYER_1P2P_SELECTABLE_ROWS)
	{
		return;
	}

	// row 0 is 1P, row 1 is 2P
	GAME_TRACKER->numPlyrNextGame = menu->rowSelected + 1;

	// go to difficulty box
	menu->ptrNextBox_InHierarchy = &MM_MENU_DIFFICULTY;

	menu->state |= ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY;
	return;

UNINITIALIZED:
	previousMenuOwner->ptrPrevBox_InHierarchy->state &= ~(ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY);

	GAME_TRACKER->numPlyrNextGame = 1;

	MM_CHARACTER_SELECT_TRANSITION_STATE = ENTERING_MENU;
	return;
}

void MM_MenuProc_2p3p4p(struct RectMenu *menu)
{
	register struct RectMenu *menuOwner CTR_PSX_REGISTER("$4") = menu;
	struct RectMenu *selectedMenu;
	s16 row;

	selectedMenu = menu;
	row = selectedMenu->rowSelected;

	// if uninitialized
	if (row == -1)
	{
		goto UNINITIALIZED;
	}

	if (row < -1)
	{
		return;
	}

	// row is 0, 1, 2
	if (row >= MM_PLAYER_2P3P4P_SELECTABLE_ROWS)
	{
		return;
	}

	// row 0 is 2P, row 1 is 3P, row 2 is 4P
	GAME_TRACKER->numPlyrNextGame = selectedMenu->rowSelected + 2;

	MM_TITLE_MENU_STATE = TITLE_MENU_STATE_EXITING;
	MM_DESIRED_MENU_INDEX = MM_EXIT_ROUTE_CHARACTER_SELECT;

	selectedMenu->state |= ONLY_DRAW_TITLE;
	return;

UNINITIALIZED:
	menuOwner->ptrPrevBox_InHierarchy->state &= ~(ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY);

	GAME_TRACKER->numPlyrNextGame = 1;

	MM_CHARACTER_SELECT_TRANSITION_STATE = ENTERING_MENU;
	return;
}

void MM_ToggleRows_Difficulty(void)
{
	struct RectMenu *difficultyMenu;
	s16 *firstUnlockBits;
	struct GameProgress *progress;
	struct GameTracker *gGT;
	b16 shouldCheckNextTrack;
	b16 finalUnlockState;
	s16 difficultyIndex;
	s16 trackIndex;
	s16 *firstUnlockBit;
	s16 *innerFirstUnlockBit;
	s16 *firstUnlockBitCopy;
	struct MenuRow *difficultyRow;
	u32 *unlockWord;
	s32 unlockBit;
	u32 isUnlocked;
	s32 lngIndex;
	s32 signedDifficultyIndex;
	s32 stringIndexOffset;

	difficultyMenu = &MM_MENU_DIFFICULTY;
	difficultyIndex = 0;
	firstUnlockBits = MM_CUP_DIFFICULTY_FIRST_UNLOCK_BIT;
	progress = &GAME_PROGRESS;
	gGT = GAME_TRACKER;

	// check 3 modes (easy, medium, hard)
	for (/**/; difficultyIndex < MM_DIFFICULTY_COUNT; difficultyIndex++)
	{
		firstUnlockBit = (s16 *)((u32)(difficultyIndex * sizeof(*firstUnlockBits)) + (u32)firstUnlockBits);
		firstUnlockBitCopy = firstUnlockBit;

		// if negative (for EASY row), skip
		if (*firstUnlockBit < 0)
		{
			continue;
		}

		// assume unlocked
		shouldCheckNextTrack = 1;
		trackIndex = 0;
		innerFirstUnlockBit = firstUnlockBitCopy;

		// check 4 bits starting at bitIndex,
		// one for each track in cup
		for (/**/; trackIndex < MM_CUP_TRACK_COUNT; trackIndex++, shouldCheckNextTrack = (b16)isUnlocked)
		{
			isUnlocked = 0;

			// if not determined locked
			if (shouldCheckNextTrack)
			{
				unlockBit = (s32)*innerFirstUnlockBit + trackIndex;

				// check what is unlocked
				unlockWord = (u32 *)((u32)((unlockBit >> 5) * sizeof(*unlockWord)) + (u32)progress);
				isUnlocked = (unlockWord[1] >> (unlockBit & 0x1f)) & 1;
			}
		}

		// get current value of lng index,
		// for easy, medium, hard
		signedDifficultyIndex = (s16)difficultyIndex;
		CTR_PSX_KEEP_VALUE(signedDifficultyIndex);
		stringIndexOffset = signedDifficultyIndex * sizeof(s16);
		{
			register s16 *stringIndices CTR_PSX_REGISTER("$2");

			CTR_PSX_LOAD_SYMBOL_PAGE_AFTER(stringIndices, MM_CUP_DIFFICULTY_STRING_INDEX_ASM_NAME, stringIndexOffset);
			CTR_PSX_ADD_SYMBOL_LOW(stringIndices, stringIndices, MM_CUP_DIFFICULTY_STRING_INDEX_ASM_NAME, MM_CUP_DIFFICULTY_STRING_INDEX);
			lngIndex = *(s16 *)((u32)stringIndexOffset + (u32)stringIndices);
		}
		difficultyRow = (struct MenuRow *)((u32)(signedDifficultyIndex * sizeof(*difficultyRow)) + (u32)difficultyMenu->rows);
		finalUnlockState = shouldCheckNextTrack;
		isUnlocked = 0;

		if (
		// if locked
#ifdef CTR_NATIVE
		    ((u32)(u16)finalUnlockState == isUnlocked) &&
#else
		    (finalUnlockState == isUnlocked) &&
#endif

		    // If you're in Arcade mode
		    ((gGT->gameMode1 & ARCADE_MODE) != isUnlocked) &&

		    // if you are in Arcade or VS cup
		    ((gGT->gameMode2 & CUP_ANY_KIND) != isUnlocked))
		{
			// use high bits for "LOCKED"
			lngIndex |= MENU_ROW_LOCKED;
		}

		// save new value
		difficultyRow->stringIndex = lngIndex;
	}
}
void MM_MenuProc_Difficulty(struct RectMenu *menu)
{
	register struct RectMenu *menuOwner CTR_PSX_REGISTER("$4") = menu;
	struct RectMenu *selectedMenu;
	s16 row;

	selectedMenu = menu;
	row = selectedMenu->rowSelected;

	// if uninitialized
	if (row == -1)
	{
		goto UNINITIALIZED;
	}

	if (row < -1)
	{
		return;
	}

	// if you are on a valid row
	if (row >= MM_DIFFICULTY_COUNT)
	{
		return;
	}

	// set difficulty to value, from array of fixed difficulty values
	GAME_TRACKER->arcadeDifficulty = MM_CUP_DIFFICULTY_SPEED[row];
#ifdef USE_ONLINE
	// ctr-native: ONLINE > ARCADE has no players menu, the room's humans play (session 32b)
	if (ONLINE_ROOM && octrOnlineArcade)
		GAME_TRACKER->numPlyrNextGame = OnlineRoom_Humans();
#endif

	MM_TITLE_MENU_STATE = TITLE_MENU_STATE_EXITING;
	MM_DESIRED_MENU_INDEX = MM_EXIT_ROUTE_CHARACTER_SELECT;

	selectedMenu->state |= ONLY_DRAW_TITLE;
	return;

UNINITIALIZED:
	menuOwner->ptrPrevBox_InHierarchy->state &= ~(ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY);
	return;
}

void MM_MenuProc_SingleCup(struct RectMenu *menu)
{
	struct RectMenu *previousMenuOwner;
	s16 row;

	previousMenuOwner = menu;
	row = menu->rowSelected;

	if (row == -1)
	{
		goto UNINITIALIZED;
	}

	if (row < -1)
	{
		return;
	}

	if (row >= MM_RACE_TYPE_SELECTABLE_ROWS)
	{
		return;
	}

	// disable Cup mode
	GAME_TRACKER->gameMode2 &= ~(CUP_ANY_KIND);

	// if you choose cup mode
	if (menu->rowSelected != 0)
	{
		// enable cup mode
		GAME_TRACKER->gameMode2 |= CUP_ANY_KIND;
	}

	menu->state |= ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY;

	// if mode is Arcade
	if ((GAME_TRACKER->gameMode1 & ARCADE_MODE) != 0)
	{
		// set next menu to 1P+2P select
		menu->ptrNextBox_InHierarchy = &MM_MENU_PLAYERS_1P2P;
		MM_CHARACTER_SELECT_TRANSITION_STATE = IN_MENU;
		return;
	}

	// if mode is VS

#ifdef USE_ONLINE
	// ctr-native: ONLINE > VS has no players menu, the room's humans play (session 32b) ; the
	// last guest gone meanwhile : back to the ONLINE menu, its VS row grey
	if (ONLINE_ROOM && octrOnlineMenuPath)
	{
		if (OnlineRoom_Humans() < 2)
		{
			menu->state &= ~(ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY);
			previousMenuOwner->ptrPrevBox_InHierarchy->state &= ~(ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY);
			return;
		}
		OnlineMenu_ToCharacters(menu);
		return;
	}
#endif

	// set next menu to 2P+3P+4P (vs or battle)
	menu->ptrNextBox_InHierarchy = &MM_MENU_PLAYERS_2P3P4P;
	MM_CHARACTER_SELECT_TRANSITION_STATE = EXITING_MENU;
	return;

UNINITIALIZED:
	previousMenuOwner->ptrPrevBox_InHierarchy->state &= ~(ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY);
}

void MM_MenuProc_NewLoad(struct RectMenu *menu)
{
	// row number
	s16 row;

	row = menu->rowSelected;

	switch (row)
	{
	case 0:
		// MM_Title transitioning out
		MM_TITLE_MENU_STATE = TITLE_MENU_STATE_EXITING;

		// New was chosen
		MM_DESIRED_MENU_INDEX = MM_EXIT_ROUTE_ADV_NEW;

		menu->state |= ONLY_DRAW_TITLE;
		return;

	case 1:
		// MM_Title transitioning out
		MM_TITLE_MENU_STATE = TITLE_MENU_STATE_EXITING;

		// Load was chosen
		MM_DESIRED_MENU_INDEX = MM_EXIT_ROUTE_ADV_LOAD;

		menu->state |= ONLY_DRAW_TITLE;
		return;

	case -1:
		menu->ptrPrevBox_InHierarchy->state &= ~(ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY);
		return;

	default:
		return;
	}
}

struct RectMenu *MM_AdvNewLoad_GetMenuPtr(void)
{
	// menu for new/load
	return &MM_MENU_ADVENTURE;
}

void MM_ResetAllMenus(void)
{
	u16 menuIndex;
	for (menuIndex = 0; menuIndex < MM_MENU_RESET_COUNT; menuIndex++)
	{
#ifdef CTR_NATIVE
		struct RectMenu *menu = MM_MENU_POINTERS[(s16)menuIndex];

		// NOTE(aalhendi): Retail resets one menu per array slot; native walks
		// chained menus because overlay 230 data is not reloaded.
		do
		{
			struct RectMenu *next = menu->ptrNextBox_InHierarchy;

			menu->state |= RECTMENU_CLOSE_TRANSIENT;
			menu->state &= ~(ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY);
			menu->ptrNextBox_InHierarchy = 0;
			menu->ptrPrevBox_InHierarchy = 0;

			menu = next;
		} while (menu != 0);
#else
		MM_MENU_POINTERS[(s16)menuIndex]->state |= RECTMENU_CLOSE_TRANSIENT;
		MM_MENU_POINTERS[(s16)menuIndex]->state &= ~(ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY);
		MM_MENU_POINTERS[(s16)menuIndex]->ptrNextBox_InHierarchy = 0;
		MM_MENU_POINTERS[(s16)menuIndex]->ptrPrevBox_InHierarchy = 0;
#endif
	}

	// unused
	sdata_static.framesRemainingInMenu = MM_MENU_RESET_DONE_FRAMES;
}

void MM_JumpTo_Title_Returning(void)
{
	// return to main menu from another menu
	MM_TITLE_MENU_STATE = TITLE_MENU_STATE_RETURNING;

	// return to main menu
	MM_DESIRED_MENU = &MM_MENU_MAIN;

	MM_TITLE_MENU_TRANSITION_FRAME = MM_TITLE_TRANSITION_DURATION;

#ifdef USE_ONLINE
	// ctr-native: in a Netplay room (session 32) the character select's way back
	// is the ONLINE menu, still in the room ; its Triangle then the main menu
	if (ONLINE_ROOM && octrOnlineMenuPath)
	{
		MM_MENU_MAIN.rowSelected = ONLINE_MAIN_ROW;
		MM_MENU_MAIN.ptrNextBox_InHierarchy = &onlineMenu;
		MM_MENU_MAIN.state |= ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY;
		OnlineMenus_Fold();
	}
#endif
}

void MM_JumpTo_Title_FirstTime(void)
{
	register struct GameTracker *gGT CTR_PSX_REGISTER("$4");
	register struct RectMenu *mainMenu CTR_PSX_REGISTER("$5");

	MM_ResetAllMenus();

	MainStats_ClearBattleVS();

	// open Main Menu for the first time
	mainMenu = &MM_MENU_MAIN;
	MM_ACTIVE_MENU = mainMenu;

	MM_TITLE_INTRO_FRAME = 0;
	gGT = GAME_TRACKER;

	// first time in main menu
	// (play crash trophy anim)
	MM_TITLE_MENU_STATE = TITLE_MENU_STATE_INTRO;

	// reset countdown clock for battle or crystal challenge
	gGT->originalEventTime = TITLE_INITIAL_EVENT_TIME;

	mainMenu->state &= ~(EXECUTE_FUNCPTR | ONLY_DRAW_TITLE);
	mainMenu->state |= DISABLE_INPUT_ALLOW_FUNCPTRS;

	// distance to screen (perspective)
	gGT->pushBuffer[0].distanceToScreen_PREV = TITLE_DEFAULT_DISTANCE_TO_SCREEN;
	gGT->pushBuffer[0].distanceToScreen_CURR = TITLE_DEFAULT_DISTANCE_TO_SCREEN;
	gGT->gameMode1 &= ~(TIME_TRIAL);
}

void MM_JumpTo_BattleSetup(void)
{
	register struct RectMenu *menu CTR_PSX_REGISTER("$4");

	// Go to battle setup
	menu = &MM_MENU_BATTLE_WEAPONS;
	MM_ACTIVE_MENU = menu;

	menu->state &= ~(ONLY_DRAW_TITLE);

	MM_Battle_Init();
}

void MM_JumpTo_TrackSelect(void)
{
	register struct RectMenu *menu CTR_PSX_REGISTER("$4");

	// return to track selection
	menu = &MM_MENU_TRACK_SELECT;
	MM_ACTIVE_MENU = menu;

	menu->state &= ~(ONLY_DRAW_TITLE);

	MM_TrackSelect_Init();
}

void MM_JumpTo_Characters(void)
{
	register struct RectMenu *menu CTR_PSX_REGISTER("$4");

	// return to character selection
	menu = &MM_MENU_CHARACTER_SELECT;
	MM_ACTIVE_MENU = menu;

	menu->state &= ~(ONLY_DRAW_TITLE);

	MM_Characters_RestoreIDs();
}

void MM_JumpTo_Scrapbook(void)
{
	register struct RectMenu *menu CTR_PSX_REGISTER("$4");

	// go to scrapbook
	menu = &MM_MENU_SCRAPBOOK;
	MM_ACTIVE_MENU = menu;

	menu->state &= ~(ONLY_DRAW_TITLE);

	MM_Scrapbook_Init();
}
