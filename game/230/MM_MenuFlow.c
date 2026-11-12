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
// JOIN, beside the three modes (session 28) : its string takes a slot as NETPLAY's does
#define ONLINE_LNG_JOIN 0x9e
#define ONLINE_JOIN_ROW 3
// MORE INFO, under them (session 29) : what NETPLAY is and its limits, asked for
#define ONLINE_LNG_INFO 0xa1
#define ONLINE_INFO_ROW 4
static struct MenuRow onlineRowsModes[6] =
{
	{0x4F, 0, 1, 0, 0},
	{0x50, 0, 2, 1, 1},
	{LNG_ARCADE, 1, 3, 2, 2},
	{ONLINE_LNG_JOIN, 2, 4, 3, 3},
	{ONLINE_LNG_INFO, 3, 4, 4, 4},
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

// A room that could not open (session 28 ; the NO RELAY KEY box of session 32) : no relay key in
// the page's Settings, a key the relay refused, a relay that does not answer. The box says which
// and offers the page's Netplay settings, or another try. Its strings take language slots the
// mod's own menus use on native only (ONLINE_LNG_ROW's neighbours).
#define ONLINE_LNG_NO_KEY 0x9b
#define ONLINE_LNG_OPEN_SETTINGS 0x9c
#define ONLINE_LNG_BACK 0x9d
// frames a room asked for may take to come on : past them the relay is said offline
#define NETPLAY_OPEN_FRAMES 1800

// What the page says of the room a mode or JOIN asked for (NativeWeb_NetplayStatus ;
// web/online/page.js NP)
enum NetplayStatus
{
	NETPLAY_IDLE = 0,
	NETPLAY_BUSY = 1,
	NETPLAY_WAITING_HOST = 2,
	NETPLAY_IN_ROOM = 3,
	NETPLAY_NO_KEY = 10,
	NETPLAY_KEY_REFUSED = 11,
	NETPLAY_OFFLINE = 12,
	NETPLAY_NO_ROOM = 13,
	NETPLAY_FULL = 14,
	NETPLAY_REFUSED = 15,
};
// The screens NETPLAY draws over the game's menus (OnlineNetplay_Frame)
enum NetplayScreen
{
	NETPLAY_SCREEN_NONE,
	NETPLAY_SCREEN_OPENING, // a mode picked : its room on its way
	NETPLAY_SCREEN_JOIN,    // JOIN : the dials
	NETPLAY_SCREEN_JOINING, // the dials sent : the room, then the host's yes
	NETPLAY_SCREEN_INVITE,  // the room's code, large
	NETPLAY_SCREEN_ASK,     // a guest who typed the code : ACCEPT / REFUSE
	NETPLAY_SCREEN_COUCH_NO, // Couch did not open : why, and what to do
	NETPLAY_SCREEN_HELP,     // what NETPLAY or Couch is and its limits, before it is launched
};
static int netplayScreen;
static int netplayRow;    // the mode whose room is opening
static int netplayFrames; // left for that room
static int netplayError;  // the box's reason (enum NetplayStatus)
static int netplayCouch;  // the room on its way is Couch's (session 29), not a NETPLAY mode's
static int netplayHelp;   // the help page up : 0 NETPLAY's, 1 Couch's
static int netplayHelpBack; // the screen it goes back to (INVITE, or none : the NETPLAY menu)
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

static void OnlineMenu_Host(int row);
static void NetplayJoin_Open(void);
static void NetplayHelp_Open(int couch, int back);

// The box under the NETPLAY menu : why the room did not open
static void OnlineMenu_ErrorBox(int status)
{
	netplayError = status;
	onlineMenuNoKey.rowSelected = 0;
	onlineMenu.ptrNextBox_InHierarchy = &onlineMenuNoKey;
	onlineMenu.state |= ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY;
}

// Cross on its first row : the page's panel (a key missing or refused), or another try (the
// relay silent) ; BACK, Triangle or Circle : the NETPLAY menu
static void OnlineNoKey_Proc(struct RectMenu *menu)
{
	s16 row = menu->rowSelected;

	if (row < -1 || row > 1)
		return;
	menu->ptrPrevBox_InHierarchy->state &= ~(ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY);
	if ((row != 0) || ((sdata->gGamepads->gamepad[0].buttonsTapped & BTN_CIRCLE) != 0))
		return;
	if (netplayError != NETPLAY_OFFLINE)
		NativeWeb_OpenMultiplayer();
	else if (onlineMenu.rowSelected != ONLINE_JOIN_ROW)
		OnlineMenu_Host(onlineMenu.rowSelected);
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

// Local play on the web (session 29) : a mode's players are the players who are in — P1, who
// navigates, and the seats P2-P4, held by a device that pressed Start on the character select or
// by a Couch guest (platform/native_input.c). No players menu : VS, BATTLE and ARCADE go to the
// select with whoever is in, and it follows who comes and goes as a Netplay room's does.
static int LocalSeats_On(void)
{
#if defined(__EMSCRIPTEN__)
	return !octrBootOnline && !ONLINE_ROOM;
#else
	return 0;
#endif
}

// ARCADE, VS or BATTLE : TIME TRIAL and ADVENTURE are P1's
static int Local_Multi(void)
{
	return (GAME_TRACKER->gameMode1 & (TIME_TRIAL | ADVENTURE_MODE | ADVENTURE_ARENA | ADVENTURE_CUP)) == 0;
}

static int Local_Humans(void)
{
	int max = ((GAME_TRACKER->gameMode1 & ARCADE_MODE) != 0) ? 2 : 4;
	int n = 1;

	if (!Local_Multi())
		return 1;
	while ((n < max) && (NativeWeb_SeatMask() & (1 << n)))
		n++;
	return n;
}

// the humans of the screen at hand : a room's, or local play's
static int Menu_Humans(void)
{
	return LocalSeats_On() ? Local_Humans() : OnlineRoom_Humans();
}

// A Netplay VS or BATTLE opens alone and does not start alone (session 28) : its character
// select holds the lock until a second human is there. ARCADE has its bots. A local VS or BATTLE
// on the web waits the same way (session 29).
static int OnlineRoom_NeedsPlayer(void)
{
	if (LocalSeats_On())
		return Local_Multi() && ((GAME_TRACKER->gameMode1 & ARCADE_MODE) == 0) && (Local_Humans() < 2);
	return ONLINE_ROOM && octrOnlineMenuPath && !octrOnlineArcade && (OnlineRoom_Humans() < 2);
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
	netplayScreen = NETPLAY_SCREEN_NONE;
}

// No players menu in a room (session 32b) : the room's humans, then the character select,
// as MM_MenuProc_2p3p4p's exit
static void OnlineMenu_ToCharacters(struct RectMenu *menu)
{
	GAME_TRACKER->numPlyrNextGame = Menu_Humans();
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

// ---- NETPLAY rooms from the game (session 28) ----
// A mode hosts its room by itself, INVITE shows the room's code, JOIN takes one. The code is a
// few of the game's characters (web/net/code.js) : their pictures on dials, their names under
// them. These screens are drawn by OnlineNetplay_Frame, once a frame before the menus read the
// pad : a screen that is up takes P1's presses, and the menu under it is neither run nor drawn
// that frame (MainFrame_RenderFrame) — but for OPENING ROOM, a line under the NETPLAY menu.
#define NETPLAY_CODE_MIN 3
#define NETPLAY_CODE_MAX 5
#define NETPLAY_CHARACTERS 15
#define NETPLAY_SLIDE_FRAMES 6
// between two characters of a code on screen : their names side by side must not touch
#define NETPLAY_CODE_STEP(count) (((count) > 4) ? 0x60 : ((count) > 3) ? 0x70 : 0x80)
// DecalFont's flags are an s16 : the centring bit is its sign
#define NETPLAY_CENTER ((s16)JUSTIFY_CENTER)
static s8 joinDial[NETPLAY_CODE_MAX]; // the character of each dial ; kept from one JOIN to the next
static int joinCount = NETPLAY_CODE_MIN; // dials in use
static int joinAt;                       // the dial the pad turns
static int joinSlide;                    // frames left of its picture sliding, signed by the way it turned
static int joinSaid;                     // the red line (enum NetplayStatus), 0 : none
static int askRow;                       // ACCEPT / REFUSE ; INVITE's and the Couch box's rows
static int couchPanel;                   // for the debug bridge : the players' panel is on screen
static int couchSaid;                    // for the debug bridge : the page's line is on screen

static void OnlineMenu_Host(int row)
{
	netplayRow = row;
	if (!NativeWeb_NetplayHost())
	{
		OnlineMenu_ErrorBox(NETPLAY_NO_KEY);
		return;
	}
	netplayScreen = NETPLAY_SCREEN_OPENING;
	netplayFrames = NETPLAY_OPEN_FRAMES;
}

static void NetplayJoin_Open(void)
{
	netplayScreen = NETPLAY_SCREEN_JOIN;
	joinAt = 0;
	joinSlide = 0;
	joinSaid = 0;
	// a room joined from here does not make the NETPLAY menu « left »
	octrFreshMenu = 0;
}

// back to the NETPLAY menu
static void NetplayJoin_Close(void)
{
	netplayScreen = NETPLAY_SCREEN_NONE;
	octrFreshMenu = 1;
}

static struct Icon *Netplay_CharacterIcon(int character)
{
	return GAME_TRACKER->ptrIcons[GAME_CHARACTER_METADATA[character].iconID];
}

// a character's picture centred on x, its top at y
static void Netplay_DrawCharacter(int character, int x, int y, int scale)
{
	struct GameTracker *gGT = GAME_TRACKER;
	struct Icon *icon = Netplay_CharacterIcon(character);
	int width = FP_Mult(icon->texLayout.u1 - icon->texLayout.u0, scale);

	Color tint = MakeColor(0x80, 0x80, 0x80);

	// as the character select draws its icons (UI_DrawDriverIcon does not scale its texture)
	DecalHUD_DrawPolyGT4(icon, x - (width / 2), y, &gGT->backBuffer->primMem, gGT->pushBuffer_UI.ptrOT, tint, tint, tint, tint, TRANS_50_DECAL, scale);
}

// the bordered panel every one of these screens sits on, as a menu box's ; drawn after its
// text, so behind it. `layers` : the box's dark glass that many times (a menu box has one ; a
// screen that covers the game is nearly opaque with three)
static void Netplay_DrawPanel(int x, int y, int w, int h, int layers)
{
	RECT r = {.x = x, .y = y, .w = w, .h = h};
	RECT glass = {.x = x + 3, .y = y + 2, .w = w - 6, .h = h - 4};
	u32 *ot = GAME_TRACKER->backBuffer->otMem.uiOT;

	RECTMENU_DrawInnerRect(&r, 0, ot);
	for (int i = 1; i < layers; i++)
		RECTMENU_DrawInnerRect(&glass, 2, ot);
}

// the menus' own arrow (the high scores' left / right), turned to point up or down, centred on x
static void Netplay_DrawArrow(int x, int y, int up)
{
	struct GameTracker *gGT = GAME_TRACKER;
	struct Icon *icon = (ICONGROUP_GETICONS(gGT->iconGroup[4]))[0x38];
	Color tint = MakeColor(0x80, 0x80, 0x80);

	DecalHUD_Arrow2D(icon, x, y, &gGT->backBuffer->primMem, gGT->pushBuffer_UI.ptrOT, tint, tint, tint, tint, 0, FP(1.0), up ? 0x400 : 0xc00);
}

// `count` characters in a row centred on the screen, their names under them ; `at` : the dial
// in hand — in a square of its own, an arrow above and below it (Up / Down turn it), its name
// lit, its picture sliding as it turns ; -1 : none
static void Netplay_DrawCode(const s8 *code, int count, int y, int at)
{
	int step = NETPLAY_CODE_STEP(count);
	int x0 = 0x100 - ((count - 1) * step) / 2;

	for (int i = 0; i < count; i++)
	{
		int x = x0 + i * step;

		Netplay_DrawCharacter(code[i], x, y + ((i == at) ? joinSlide * 2 : 0), FP(1.5));
		DecalFont_DrawLine(GAME_LANGUAGE_STRINGS[GAME_CHARACTER_METADATA[code[i]].name_LNG_short], x, y + 0x2c, FONT_SMALL,
		                   NETPLAY_CENTER | ((i == at) ? ORANGE : WHITE));
		if (i == at)
		{
			Netplay_DrawArrow(x, y - 0x10, 1);
			Netplay_DrawArrow(x, y + 0x40, 0);
			Netplay_DrawPanel(x - 0x26, y - 6, 0x4c, 0x40, 1);
		}
	}
}

// the page's room code (one hex digit per character) as character ids ; their count
static int Netplay_RoomCode(s8 *code)
{
	char text[NETPLAY_CODE_MAX + 1];
	int n = NativeWeb_RoomCode(text, sizeof(text));

	for (int i = 0; i < n; i++)
	{
		int id = (text[i] <= '9') ? (text[i] - '0') : (text[i] - 'a' + 10);

		if ((id < 0) || (id >= NETPLAY_CHARACTERS))
			return 0;
		code[i] = (s8)id;
	}
	return (n >= NETPLAY_CODE_MIN) ? n : 0;
}

// The room's code on the menus (the tag of 32f) : its characters, small, in a box whose top
// border carries ROOM (the user, session 28). Top right ; bottom right on the track and cup
// selects, whose title sits top right.
void OnlineRoom_DrawCodeTag(void)
{
	s8 code[NETPLAY_CODE_MAX];
	int count = Netplay_RoomCode(code);
	int low = (sdata->ptrActiveMenu == &MM_MENU_TRACK_SELECT) || (sdata->ptrActiveMenu == &MM_MENU_CUP_SELECT);
	int y = low ? 0xb8 : 0x0a;
	int w = count * 0x1a + 0x0c;
	int x = 0x1f8 - w;

	if (!count)
		return;
	DecalFont_DrawLine("ROOM", x + (w / 2), y - 4, FONT_SMALL, NETPLAY_CENTER | WHITE);
	for (int i = 0; i < count; i++)
		Netplay_DrawCharacter(code[i], x + 0x13 + i * 0x1a, y + 4, FP(0.6));
	Netplay_DrawPanel(x, y, w, 0x18, 1);
}

static void NetplayJoin_Send(void)
{
	char text[NETPLAY_CODE_MAX + 1];

	for (int i = 0; i < joinCount; i++)
		text[i] = "0123456789abcde"[joinDial[i]];
	text[joinCount] = 0;
	joinSaid = 0;
	if (!NativeWeb_NetplayJoin(text))
	{
		NetplayJoin_Close();
		OnlineMenu_ErrorBox(NETPLAY_NO_KEY);
		return;
	}
	netplayScreen = NETPLAY_SCREEN_JOINING;
	netplayFrames = NETPLAY_OPEN_FRAMES;
}

// JOIN : Up / Down turn the dial, Left / Right change dial (Right past the last adds one, up to
// five ; Square takes the last one away), Start or Cross on the last dial joins, Triangle goes back
static void NetplayJoin_Frame(int tap)
{
	const char *said = (joinSaid == NETPLAY_NO_ROOM)   ? "NO SUCH ROOM"
	                   : (joinSaid == NETPLAY_FULL)    ? "ROOM FULL"
	                   : (joinSaid == NETPLAY_REFUSED) ? "THE HOST SAID NO"
	                   : (joinSaid != 0)               ? "RELAY OFFLINE"
	                                                   : 0;

	if (joinSlide > 0)
		joinSlide--;
	else if (joinSlide < 0)
		joinSlide++;

	if (tap & BTN_TRIANGLE)
	{
		OtherFX_Play(2, 1);
		NetplayJoin_Close();
		return;
	}
	if (tap & (BTN_UP | BTN_DOWN))
	{
		int way = (tap & BTN_UP) ? -1 : 1;

		joinDial[joinAt] = (s8)((joinDial[joinAt] + NETPLAY_CHARACTERS + way) % NETPLAY_CHARACTERS);
		joinSlide = way * NETPLAY_SLIDE_FRAMES;
		joinSaid = 0;
		OtherFX_Play(0, 1);
	}
	else if ((tap & BTN_LEFT) && (joinAt > 0))
	{
		joinAt--;
		joinSlide = 0;
		OtherFX_Play(0, 1);
	}
	else if ((tap & BTN_START) || ((tap & BTN_CROSS_one) && (joinAt == joinCount - 1)))
	{
		OtherFX_Play(1, 1);
		NetplayJoin_Send();
		return;
	}
	else if (tap & (BTN_RIGHT | BTN_CROSS_one))
	{
		if (joinAt < joinCount - 1)
			joinAt++;
		else if ((tap & BTN_RIGHT) && (joinCount < NETPLAY_CODE_MAX))
		{
			joinDial[joinCount++] = 0;
			joinAt++;
			joinSaid = 0;
		}
		joinSlide = 0;
		OtherFX_Play(0, 1);
	}
	else if ((tap & BTN_SQUARE_one) && (joinCount > NETPLAY_CODE_MIN))
	{
		joinCount--;
		if (joinAt >= joinCount)
			joinAt = joinCount - 1;
		joinSaid = 0;
		OtherFX_Play(2, 1);
	}

	DecalFont_DrawLine("ROOM CODE", 0x100, 0x1c, FONT_BIG, NETPLAY_CENTER | ORANGE);
	Netplay_DrawCode(joinDial, joinCount, 0x48, joinAt);
	if (joinCount < NETPLAY_CODE_MAX)
	{
		// the dial a longer code would use, empty : at the right of the last one
		int step = NETPLAY_CODE_STEP(joinCount);

		DecalFont_DrawLine("+", 0x100 + ((joinCount - 1) * step) / 2 + 0x30, 0x54, FONT_BIG, NETPLAY_CENTER | GRAY);
	}
	if (said)
		DecalFont_DrawLine((char *)said, 0x100, 0x98, FONT_BIG, NETPLAY_CENTER | RED);
	DecalFont_DrawLine("TRIANGLE - BACK", 0x30, 0xae, FONT_SMALL, GRAY);
	DecalFont_DrawLine("START - JOIN", 0x1d0, 0xae, FONT_SMALL, JUSTIFY_RIGHT | WHITE);
	if (joinCount > NETPLAY_CODE_MIN)
		DecalFont_DrawLine("SQUARE - ONE LESS", 0x100, 0xae, FONT_SMALL, NETPLAY_CENTER | GRAY);
	Netplay_DrawPanel(0x20, 0x12, 0x1c0, 0xaa, 3);
}

// The dials sent : the page looks for the room, then the host says yes (a guest by code is let
// in by hand). In : this game enters the room, under the host's picture. Triangle gives up.
static void NetplayJoining_Frame(int tap)
{
	int status = NativeWeb_NetplayStatus();

	if (status == NETPLAY_IN_ROOM)
	{
		// the main menu whole again under the host's picture, as a room link finds it
		netplayScreen = NETPLAY_SCREEN_NONE;
		OnlineMenus_Fold();
		MM_MENU_MAIN.state &= ~(ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY);
		return;
	}
	if ((status == NETPLAY_NO_KEY) || (status == NETPLAY_KEY_REFUSED))
	{
		NetplayJoin_Close();
		OnlineMenu_ErrorBox(status);
		return;
	}
	if ((tap & BTN_TRIANGLE) || (status >= NETPLAY_NO_KEY) || (status == NETPLAY_IDLE) || ((status == NETPLAY_BUSY) && (--netplayFrames <= 0)))
	{
		joinSaid = (tap & BTN_TRIANGLE) ? 0 : (status >= NETPLAY_NO_KEY) ? status : NETPLAY_OFFLINE;
		NativeWeb_NetplayCancel();
		OtherFX_Play(2, 1);
		netplayScreen = NETPLAY_SCREEN_JOIN;
		return;
	}
	DecalFont_DrawLine((status == NETPLAY_WAITING_HOST) ? "WAITING FOR THE HOST" : "JOINING...", 0x100, 0x1c, FONT_BIG, NETPLAY_CENTER | ORANGE);
	Netplay_DrawCode(joinDial, joinCount, 0x48, -1);
	DecalFont_DrawLine("TRIANGLE - BACK", 0x30, 0xae, FONT_SMALL, GRAY);
	Netplay_DrawPanel(0x20, 0x12, 0x1c0, 0xaa, 3);
}

// A mode's room on its way : the mode's own screens once it is on, the reason in a box if not
static void NetplayOpening_Frame(int tap)
{
	int status = NativeWeb_NetplayStatus();

	// on once this game is its room's host in its lobby : the states before it reset the menu path
	if (ONLINE_ROOM && (status == NETPLAY_IN_ROOM) && (octr->CurrState == LOBBY_HOST_TRACK_PICK))
	{
		netplayScreen = NETPLAY_SCREEN_NONE;
		onlineMenu.rowSelected = netplayRow;
		OnlineMenu_Proc(&onlineMenu);
		return;
	}
	if ((tap & BTN_TRIANGLE) || (status >= NETPLAY_NO_KEY) || (--netplayFrames <= 0))
	{
		netplayScreen = NETPLAY_SCREEN_NONE;
		NativeWeb_LeaveRoom();
		if (tap & BTN_TRIANGLE)
			OtherFX_Play(2, 1);
		else
			OnlineMenu_ErrorBox((status >= NETPLAY_NO_KEY) ? status : NETPLAY_OFFLINE);
		return;
	}
	DecalFont_DrawLine("OPENING ROOM...", 0x100, 0xb8, FONT_BIG, NETPLAY_CENTER | ORANGE);
}

// INVITE : the room's code, large, and its rows (session 29) : BACK ; MORE INFO, the help page,
// which comes back here ; and for a Couch room STOP COUCH, which closes it where the host
// stands. Triangle, Select and the other buttons close the box as BACK does.
static void NetplayInvite_Frame(int tap)
{
	s8 code[NETPLAY_CODE_MAX];
	int couch = !ONLINE_ROOM;
	int rows = couch ? 3 : 2;
	int count = Netplay_RoomCode(code);
	static const char *const labels[3] = {"BACK", "MORE INFO", "STOP COUCH"};

	if (count && (tap & (BTN_UP | BTN_DOWN)))
	{
		askRow = (askRow + ((tap & BTN_DOWN) ? 1 : rows - 1)) % rows;
		OtherFX_Play(0, 1);
		tap = 0;
	}
	if (count && (tap & BTN_CROSS_one) && (askRow == 1))
	{
		OtherFX_Play(1, 1);
		NetplayHelp_Open(couch, NETPLAY_SCREEN_INVITE);
		return;
	}
	if (count && (tap & BTN_CROSS_one) && (askRow == 2))
	{
		OtherFX_Play(2, 1);
		NativeWeb_CouchStop();
		netplayScreen = NETPLAY_SCREEN_NONE;
		return;
	}
	if (!count || (tap & (BTN_TRIANGLE | BTN_CIRCLE | BTN_CROSS_one | BTN_SQUARE_one | BTN_SELECT | BTN_START)))
	{
		OtherFX_Play(2, 1);
		netplayScreen = NETPLAY_SCREEN_NONE;
		return;
	}
	DecalFont_DrawLine("INVITE", 0x100, 0x16, FONT_BIG, NETPLAY_CENTER | ORANGE);
	DecalFont_DrawLine("ROOM CODE", 0x100, 0x2a, FONT_SMALL, NETPLAY_CENTER | WHITE);
	Netplay_DrawCode(code, count, 0x38, -1);
	// a Share room's guest has no game : its code is typed on the page (28b)
	DecalFont_DrawLine(couch ? "HOME PAGE - JOIN A ROOM" : "NETPLAY - JOIN", 0x100, 0x72, FONT_SMALL, NETPLAY_CENTER | WHITE);
	for (int i = 0; i < rows; i++)
		DecalFont_DrawLine((char *)labels[i], 0x100, (couch ? 0x82 : 0x8c) + i * 0x12, FONT_BIG, NETPLAY_CENTER | ((askRow == i) ? WHITE : GRAY));
	Netplay_DrawPanel(0x20, 0x10, 0x1c0, 0xac, 3);
}

// ---- Couch from the game, and the players who are in (session 29) ----
// On the character select of ARCADE, VS and BATTLE the pad's Select opens a Couch room (Share :
// the host's screen streamed to guests with no disc), on the relay and key of the page's Netplay
// settings ; once it is on, Select is INVITE, as in a Netplay room.
static void Couch_Start(void)
{
	askRow = 0;
	if (!NativeWeb_CouchStart())
	{
		netplayError = NETPLAY_NO_KEY;
		netplayScreen = NETPLAY_SCREEN_COUCH_NO;
		return;
	}
	netplayCouch = 1;
	netplayScreen = NETPLAY_SCREEN_OPENING;
	netplayFrames = NETPLAY_OPEN_FRAMES;
}

// Couch's room on its way : INVITE by itself once it is on, the reason in a box if not
static void CouchOpening_Frame(int tap)
{
	int status = NativeWeb_CouchStatus();

	if ((status == NETPLAY_IN_ROOM) && NativeWeb_ShareHost())
	{
		netplayCouch = 0;
		netplayScreen = NETPLAY_SCREEN_INVITE;
		OtherFX_Play(1, 1);
		return;
	}
	if ((tap & BTN_TRIANGLE) || (status >= NETPLAY_NO_KEY) || (--netplayFrames <= 0))
	{
		netplayCouch = 0;
		netplayScreen = NETPLAY_SCREEN_NONE;
		NativeWeb_CouchStop();
		if (tap & BTN_TRIANGLE)
		{
			OtherFX_Play(2, 1);
			return;
		}
		netplayError = (status >= NETPLAY_NO_KEY) ? status : NETPLAY_OFFLINE;
		netplayScreen = NETPLAY_SCREEN_COUCH_NO;
		return;
	}
	DecalFont_DrawLine("OPENING ROOM...", 0x100, 0x84, FONT_BIG, NETPLAY_CENTER | ORANGE);
	Netplay_DrawPanel(0x40, 0x7c, 0x180, 0x20, 3);
}

// MORE INFO (the user, session 29) : what NETPLAY or Couch is and its limits, asked for from the
// NETPLAY menu or from a room's INVITE — NETPLAY is one player per browser, each with their own
// disc ; Couch streams the host's screen, so some delay, and takes several players on the host's
// machine but one per guest. Any button goes back where it was asked from.
static void NetplayHelp_Open(int couch, int back)
{
	netplayHelp = couch;
	netplayHelpBack = back;
	netplayScreen = NETPLAY_SCREEN_HELP;
}

static void NetplayHelp_Frame(int tap)
{
	// a line holds about 36 of the small font's characters
	static const char *const lines[2][5] = {
		{"EVERYONE ON THEIR OWN SCREEN", "EACH PLAYER NEEDS THEIR OWN DISC", "ONE PLAYER PER BROWSER", "UP TO 4 PLAYERS IN A ROOM", NULL},
		{"YOUR SCREEN IS STREAMED", "GUESTS NEED NO DISC", "THEY MAY SEE SOME DELAY", "SEVERAL HERE, ONE PER GUEST", "UP TO 4 PLAYERS IN ALL"},
	};
	int count = (lines[netplayHelp][4] != NULL) ? 5 : 4;

	if (tap & (BTN_TRIANGLE | BTN_CIRCLE | BTN_CROSS_one | BTN_SQUARE_one | BTN_SELECT | BTN_START))
	{
		OtherFX_Play(2, 1);
		netplayScreen = netplayHelpBack;
		return;
	}
	DecalFont_DrawLine(netplayHelp ? "COUCH" : "NETPLAY", 0x100, 0x1a, FONT_BIG, NETPLAY_CENTER | ORANGE);
	for (int i = 0; i < count; i++)
		DecalFont_DrawLine((char *)lines[netplayHelp][i], 0x100, 0x34 + i * 0x0c, FONT_SMALL, NETPLAY_CENTER | WHITE);
	DecalFont_DrawLine("BACK", 0x100, 0x88, FONT_BIG, NETPLAY_CENTER | WHITE);
	Netplay_DrawPanel(0x20, 0x12, 0x1c0, 0xaa, 3);
}

// Couch did not open : NETPLAY's words (no key, a key refused, a silent relay), the page's
// Netplay settings or another try, or BACK (Triangle too)
static void CouchNo_Frame(int tap)
{
	int offline = netplayError == NETPLAY_OFFLINE;

	if (tap & (BTN_UP | BTN_DOWN))
	{
		askRow ^= 1;
		OtherFX_Play(0, 1);
	}
	if (tap & (BTN_CROSS_one | BTN_TRIANGLE))
	{
		int go = ((tap & BTN_TRIANGLE) == 0) && (askRow == 0);

		OtherFX_Play(go ? 1 : 2, 1);
		netplayScreen = NETPLAY_SCREEN_NONE;
		if (go && offline)
			Couch_Start();
		else if (go)
			NativeWeb_OpenMultiplayer();
		return;
	}
	DecalFont_DrawLine(offline ? "RELAY OFFLINE" : (netplayError == NETPLAY_KEY_REFUSED) ? "KEY REFUSED" : "NO RELAY KEY", 0x100, 0x40, FONT_BIG,
	                   NETPLAY_CENTER | ORANGE);
	DecalFont_DrawLine(offline ? "TRY AGAIN" : "OPEN SETTINGS", 0x100, 0x60, FONT_BIG, NETPLAY_CENTER | ((askRow == 0) ? WHITE : GRAY));
	DecalFont_DrawLine("BACK", 0x100, 0x74, FONT_BIG, NETPLAY_CENTER | ((askRow == 1) ? WHITE : GRAY));
	Netplay_DrawPanel(0x50, 0x36, 0x160, 0x58, 3);
}

// The two small pictures of a player in the panel : where it plays from, with what. 9 x 7, a
// row per word, drawn as runs of two-unit squares (the game has no such icons).
static const u16 couchIcons[4][7] = {
	{0x010, 0x038, 0x07c, 0x0fe, 0x06c, 0x06c, 0x07c}, // a house : this machine
	{0x07c, 0x092, 0x111, 0x1ff, 0x111, 0x092, 0x07c}, // a globe : a Couch guest
	{0x000, 0x0fe, 0x1bb, 0x1ff, 0x1c7, 0x183, 0x000}, // a pad
	{0x1ff, 0x155, 0x1ff, 0x155, 0x1ff, 0x139, 0x1ff}, // a keyboard
};

static void Couch_DrawIcon(int which, int x, int y)
{
	struct GameTracker *gGT = GAME_TRACKER;
	Color white = MakeColor(0xe0, 0xe0, 0xe0);

	for (int row = 0; row < 7; row++)
	{
		u16 bits = couchIcons[which][row];

		for (int col = 0; col < 9; col++)
		{
			int run = col;

			if ((bits & (0x100 >> col)) == 0)
				continue;
			while ((run < 8) && (bits & (0x100 >> (run + 1))))
				run++;
			{
				RECT r = {.x = x + col * 2, .y = y + row, .w = (run - col + 1) * 2, .h = 1};

				CTR_Box_DrawSolidBox(&r, &white, gGT->pushBuffer_UI.ptrOT, &gGT->backBuffer->primMem);
			}
			col = run;
		}
	}
}

// Who is in, while P1 holds L1 and R1 on the menus : each player's number, this machine or
// Couch, a keyboard or a pad, and its character
static void Couch_DrawPlayers(void)
{
	int n = 1;

	while ((n < 4) && (NativeWeb_SeatMask() & (1 << n)))
		n++;
	DecalFont_DrawLine("PLAYERS", 0x194, 0x30, FONT_BIG, NETPLAY_CENTER | ORANGE);
	for (int p = 0; p < n; p++)
	{
		int kind = NativeWeb_PlayerKind(p);
		int y = 0x48 + p * 0x16;
		char tag[4] = {'P', (char)('1' + p), 0, 0};

		DecalFont_DrawLine(tag, 0x140, y + 2, FONT_SMALL, WHITE);
		Couch_DrawIcon((kind & 2) ? 1 : 0, 0x158, y + 2);
		Couch_DrawIcon((kind & 4) ? 3 : 2, 0x170, y + 2);
		Netplay_DrawCharacter(GAME_CHARACTER_IDS[p], 0x196, y - 2, FP(0.6));
		DecalFont_DrawLine(GAME_LANGUAGE_STRINGS[GAME_CHARACTER_METADATA[GAME_CHARACTER_IDS[p]].name_LNG_short], 0x1a6, y + 2, FONT_SMALL, ORANGE);
	}
	Netplay_DrawPanel(0x134, 0x28, 0xc4, 0x24 + n * 0x16, 3);
}

// The page's line for the host (a guest with no direct connection), top of the screen
static int Couch_DrawSaid(void)
{
	char line[40];

	if (!NativeWeb_CouchSaid(line, sizeof(line)))
		return 0;
	DecalFont_DrawLine(line, 0x100, 0x2c, FONT_SMALL, NETPLAY_CENTER | ORANGE);
	return 1;
}

// Local play's own hints on the character select : Couch bottom left ; bottom right, in turn
// (the line holds two of them, not four), who may join, how to leave, and the players' panel
static void Couch_DrawHints(int share)
{
	static int frames;
	char join[40], key[16];
	const char *hints[3];
	int count = 0;
	int joinable = NativeWeb_Joinable();
	int local = 0;

	for (int p = 1; p < 4; p++)
		local |= (NativeWeb_PlayerKind(p) & 3) == 1;
	if (!share)
		DecalFont_DrawLine("SELECT - COUCH", 0x14, 0xcc, FONT_SMALL, GRAY);
	if (joinable && (Local_Humans() < (((GAME_TRACKER->gameMode1 & ARCADE_MODE) != 0) ? 2 : 4)))
	{
		key[0] = 0;
		if (joinable & 2)
			NativeWeb_JoinKey(key, sizeof(key));
		snprintf(join, sizeof(join), "%s%s%s - JOIN", (joinable & 1) ? "START" : "", ((joinable & 1) && key[0]) ? " OR " : "", key);
		hints[count++] = join;
	}
	if (local)
		hints[count++] = "HOLD SELECT - LEAVE";
	hints[count++] = "L1 R1 - PLAYERS";
	frames++;
	DecalFont_DrawLine((char *)hints[(frames / FPS_DOUBLE(90)) % count], 0x1f6, 0xcc, FONT_SMALL, JUSTIFY_RIGHT | GRAY);
}

// A guest who typed the code waits at the door : ACCEPT lets it in, REFUSE (or Triangle) does not
static void NetplayAsk_Frame(int tap)
{
	char name[20], line[40];

	if (!NativeWeb_AskName(name, sizeof(name)))
	{
		// it gave up
		netplayScreen = NETPLAY_SCREEN_NONE;
		return;
	}
	if (tap & (BTN_UP | BTN_DOWN))
	{
		askRow ^= 1;
		OtherFX_Play(0, 1);
	}
	if (tap & (BTN_CROSS_one | BTN_TRIANGLE))
	{
		int yes = ((tap & BTN_TRIANGLE) == 0) && (askRow == 0);

		OtherFX_Play(yes ? 1 : 2, 1);
		NativeWeb_AskAnswer(yes);
		netplayScreen = NETPLAY_SCREEN_NONE;
		return;
	}
	for (char *c = name; *c; c++)
		if ((*c >= 'a') && (*c <= 'z'))
			*c -= 'a' - 'A';
	snprintf(line, sizeof(line), "%s WANTS IN", name);
	DecalFont_DrawLine(line, 0x100, 0x40, FONT_BIG, NETPLAY_CENTER | ORANGE);
	DecalFont_DrawLine("ACCEPT", 0x100, 0x60, FONT_BIG, NETPLAY_CENTER | ((askRow == 0) ? WHITE : GRAY));
	DecalFont_DrawLine("REFUSE", 0x100, 0x74, FONT_BIG, NETPLAY_CENTER | ((askRow == 1) ? WHITE : GRAY));
	Netplay_DrawPanel(0x50, 0x36, 0x160, 0x58, 3);
}

// Once a frame on the menus, after the pad was read and before the menus use it
// (MainFrame_RenderFrame) ; 1 while one of these screens stands in for the menu
int OnlineNetplay_Frame(void)
{
	char name[20];
	int tap = sdata->buttonTapPerPlayer[0];
	int local = LocalSeats_On();
	int onSelect = (sdata->ptrActiveMenu == &MM_MENU_CHARACTER_SELECT) && (MM_CHARACTER_SELECT_MENU_STATE == IN_MENU);
	// local play's character select of ARCADE, VS or BATTLE (session 29) : Couch, and who joins
	int couchSelect = local && onSelect && Local_Multi();
	// a Share room under a code (28b) : the same tag, INVITE and door, on the game's own menus
	int share = !ONLINE_ROOM && NativeWeb_ShareHost();
	int host = share || (ONLINE_ROOM && (octr->DriverID == 0) && (NativeWeb_NetplayStatus() == NETPLAY_IN_ROOM));

	NativeWeb_SeatsOpen(couchSelect && (netplayScreen == NETPLAY_SCREEN_NONE), local);
	couchPanel = 0;
	couchSaid = 0;
	if (netplayScreen == NETPLAY_SCREEN_NONE)
	{
		if (local)
		{
			couchSaid = Couch_DrawSaid();
			if ((sdata->buttonHeldPerPlayer[0] & (BTN_L1 | BTN_R1)) == (BTN_L1 | BTN_R1))
			{
				Couch_DrawPlayers();
				couchPanel = 1;
			}
			if (couchSelect)
				Couch_DrawHints(share);
		}
		if (!host)
		{
			if (!couchSelect || ((tap & BTN_SELECT) == 0))
				return 0;
			Couch_Start();
			OtherFX_Play(1, 1);
		}
		// a guest at the door comes first ; then INVITE on the pad's Select
		else if (NativeWeb_AskName(name, sizeof(name)))
		{
			netplayScreen = NETPLAY_SCREEN_ASK;
			askRow = 0;
		}
		else if (tap & BTN_SELECT)
		{
			netplayScreen = NETPLAY_SCREEN_INVITE;
			askRow = 0;
			NativeWeb_Invite();
			OtherFX_Play(1, 1);
		}
		else
		{
			// a Netplay room's tag is its lobby's (game/OnlineCTR/thread.c) ; Share has no lobby
			if (share)
				OnlineRoom_DrawCodeTag();
			// bottom left ; not over the track and cup selects' lists
			if ((sdata->ptrActiveMenu != &MM_MENU_TRACK_SELECT) && (sdata->ptrActiveMenu != &MM_MENU_CUP_SELECT))
				DecalFont_DrawLine("SELECT - INVITE", 0x14, 0xcc, FONT_SMALL, GRAY);
			// a VS or BATTLE select whose only player locked : it waits here
			if (onSelect && OnlineRoom_NeedsPlayer() && (MM_CHARACTER_SELECT_FLAGS & 1))
			{
				// a banner over the icons : the character is picked
				DecalFont_DrawLine("WAITING FOR PLAYER 2", 0x100, 0x84, FONT_BIG, NETPLAY_CENTER | ORANGE);
				Netplay_DrawPanel(0x40, 0x7c, 0x180, 0x20, 3);
			}
			return 0;
		}
		tap = 0;
	}
	RECTMENU_ClearInput();
	switch (netplayScreen)
	{
	case NETPLAY_SCREEN_OPENING:
		if (netplayCouch)
			CouchOpening_Frame(tap);
		else
			NetplayOpening_Frame(tap);
		return 0;
	case NETPLAY_SCREEN_JOIN:
		NetplayJoin_Frame(tap);
		break;
	case NETPLAY_SCREEN_JOINING:
		NetplayJoining_Frame(tap);
		break;
	case NETPLAY_SCREEN_INVITE:
		NetplayInvite_Frame(tap);
		break;
	case NETPLAY_SCREEN_ASK:
		NetplayAsk_Frame(tap);
		break;
	case NETPLAY_SCREEN_COUCH_NO:
		CouchNo_Frame(tap);
		break;
	case NETPLAY_SCREEN_HELP:
		NetplayHelp_Frame(tap);
		break;
	}
	// Couch's room asked for from the help page or the box : its line is over the select
	if (netplayScreen == NETPLAY_SCREEN_OPENING)
		return 0;
	return netplayScreen != NETPLAY_SCREEN_NONE;
}

// Off the menus (a race, its results) the door's box does not come : one line says a guest
// waits, and the box is there with the next menu (the user, session 28b). Called once a frame
// from MainFrame_RenderFrame, for a Netplay host as for a Share one.
static int doorLine; // for the debug bridge : the line is on screen
void OnlineDoor_DrawLine(void)
{
	char name[20], line[40];

	doorLine = NativeWeb_AskName(name, sizeof(name));
	if (!doorLine)
	{
		// the page's own line (a Couch guest with no direct connection, session 29)
		couchSaid = LocalSeats_On() && Couch_DrawSaid();
		return;
	}
	for (char *c = name; *c; c++)
		if ((*c >= 'a') && (*c <= 'z'))
			*c -= 'a' - 'A';
	snprintf(line, sizeof(line), "%s WANTS IN", name);
	DecalFont_DrawLine(line, 0x100, 0x2c, FONT_SMALL, NETPLAY_CENTER | ORANGE);
}

// for the debug bridge (platform/web_debug_bridge.c, debug web builds) : what these screens show
void OnlineNetplay_Debug(s32 *out)
{
	out[0] = netplayScreen;
	out[1] = joinCount;
	out[2] = joinAt;
	out[3] = joinSaid;
	for (int i = 0; i < NETPLAY_CODE_MAX; i++)
		out[4 + i] = joinDial[i];
	out[10] = doorLine && ((GAME_TRACKER->gameMode1 & MAIN_MENU) == 0);
	out[11] = ONLINE_ROOM ? 0 : NativeWeb_ShareHost();
	out[9] = (sdata->ptrActiveMenu == &MM_MENU_CHARACTER_SELECT) && (MM_CHARACTER_SELECT_MENU_STATE == IN_MENU) && OnlineRoom_NeedsPlayer() &&
	         ((MM_CHARACTER_SELECT_FLAGS & 1) != 0);
	// Couch and the players who are in (session 29)
	out[12] = askRow;
	out[13] = netplayError;
	out[14] = NativeWeb_SeatMask();
	out[15] = 0;
	for (int p = 0; p < 4; p++)
		out[15] |= NativeWeb_PlayerKind(p) << (p * 4);
	out[16] = couchPanel;
	out[17] = NativeWeb_Joinable();
	out[18] = couchSaid;
	out[19] = netplayCouch | ((netplayScreen == NETPLAY_SCREEN_HELP) ? (netplayHelp << 1) : 0);
}

static void OnlineMenu_Proc(struct RectMenu *menu)
{
	s16 row = menu->rowSelected;

	if (row == -1)
	{
		menu->ptrPrevBox_InHierarchy->state &= ~(ONLY_DRAW_TITLE | DRAW_NEXT_MENU_IN_HIERARCHY);
		return;
	}
	if (row < -1 || row > ONLINE_INFO_ROW)
	{
		return;
	}
	if (row == ONLINE_INFO_ROW)
	{
		NetplayHelp_Open(0, NETPLAY_SCREEN_NONE);
		return;
	}
	if (row == ONLINE_JOIN_ROW)
	{
		NetplayJoin_Open();
		return;
	}
	// a mode hosts the room by itself (session 28) : its screens come once the room is on
	if (!ONLINE_ROOM)
	{
		OnlineMenu_Host(row);
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
		GAME_LANGUAGE_STRINGS[ONLINE_LNG_JOIN] = "JOIN";
		GAME_LANGUAGE_STRINGS[ONLINE_LNG_INFO] = "MORE INFO";
		GAME_LANGUAGE_STRINGS[ONLINE_LNG_NO_KEY] =
		    (netplayError == NETPLAY_OFFLINE) ? "RELAY OFFLINE" : (netplayError == NETPLAY_KEY_REFUSED) ? "KEY REFUSED" : "NO RELAY KEY";
		GAME_LANGUAGE_STRINGS[ONLINE_LNG_OPEN_SETTINGS] = (netplayError == NETPLAY_OFFLINE) ? "TRY AGAIN" : "OPEN SETTINGS";
		GAME_LANGUAGE_STRINGS[ONLINE_LNG_BACK] = "BACK";
		MM_MENU_MAIN.rows = (MM_MENU_MAIN.rows == MM_ROWS_MAIN_WITH_SCRAPBOOK) ? onlineRowsMainWithScrapbook : onlineRowsMainBasic;
		onlineMenu.posX_curr = MM_MENU_RACE_TYPE.posX_curr;
		onlineMenu.posY_curr = MM_MENU_RACE_TYPE.posY_curr;
		onlineMenuRaceType.posX_curr = MM_MENU_RACE_TYPE.posX_curr;
		onlineMenuRaceType.posY_curr = MM_MENU_RACE_TYPE.posY_curr;
		onlineMenuNoKey.posX_curr = MM_MENU_RACE_TYPE.posX_curr;
		onlineMenuNoKey.posY_curr = MM_MENU_RACE_TYPE.posY_curr;
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
			if (octrFreshMenu && (!ONLINE_ROOM || (octr->DriverID == 0)))
			{
				octrFreshMenu = 0;
				NativeWeb_LeaveRoom();
				OnlineMenus_Fresh();
			}
			// Couch's room closes here too (the user, session 29) : STOP COUCH, or the main menu
			if (!ONLINE_ROOM && NativeWeb_ShareHost())
				NativeWeb_CouchStop();
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
		// its menu at once, room or not (session 28) : a mode hosts one, JOIN looks for one
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

#ifdef USE_ONLINE
		// ctr-native web: no players menu (session 29), the players who are in
		if (LocalSeats_On())
		{
			OnlineMenu_ToCharacters(mainMenu);
			return;
		}
#endif

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
	if ((ONLINE_ROOM && octrOnlineArcade) || LocalSeats_On())
		GAME_TRACKER->numPlyrNextGame = Menu_Humans();
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
#ifdef USE_ONLINE
		// ctr-native web: no players menu (session 29) : the difficulty, then the players who are in
		if (LocalSeats_On())
		{
			menu->ptrNextBox_InHierarchy = &MM_MENU_DIFFICULTY;
			MM_CHARACTER_SELECT_TRANSITION_STATE = IN_MENU;
			return;
		}
#endif
		// set next menu to 1P+2P select
		menu->ptrNextBox_InHierarchy = &MM_MENU_PLAYERS_1P2P;
		MM_CHARACTER_SELECT_TRANSITION_STATE = IN_MENU;
		return;
	}

	// if mode is VS

#ifdef USE_ONLINE
	// ctr-native: ONLINE > VS has no players menu, the room's humans play (session 32b) — one
	// alone too (session 28 : its character select waits for a second) ; local play on the web
	// has none either (session 29)
	if ((ONLINE_ROOM && octrOnlineMenuPath) || LocalSeats_On())
	{
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
