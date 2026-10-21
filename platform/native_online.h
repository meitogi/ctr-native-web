#ifndef NATIVE_ONLINE_H
#define NATIVE_ONLINE_H

#include "native_online_transport.h"

// OnlineCTR client bridge, in-process (was CL_main.cpp).
// docs/ONLINECTR_PORT.md, D3.

// Player name (NAME_LEN chars max) and the address used for the
// "private server" entry of the server menu ("host:port").
// Defaults: env CTR_ONLINE_NAME / CTR_ONLINE_SERVER, else "Player" / 127.0.0.1:64001.
void NativeOnline_Configure(const OnlineTransport *transport, const char *name, const char *privateServer);

// Once per game frame, where the PS1 build set octr->readyToSend.
void NativeOnline_Frame(void);

unsigned int NativeOnline_FrameCount(void);

#endif
