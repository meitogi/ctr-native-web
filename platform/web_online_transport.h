#ifndef WEB_ONLINE_TRANSPORT_H
#define WEB_ONLINE_TRANSPORT_H

#include "native_online_transport.h"

// OnlineTransport of the browser build (docs/ONLINECTR_PORT.md, D3, D4, D6).
// The page (web/online/) holds the room : as a guest, connect() opens the
// link to the host ; as the host, the server core runs in this wasm and the
// host's own client reaches it over loopback. JS only queues what the
// network delivers ; poll() drains that queue once per frame.

// Address of the server menu's "Private Room" entry in the browser: the
// room of the page's room link. Entries 0-6 (public servers) are refused.
#define WEB_ONLINE_ROOM_ADDRESS "room-link"

extern const OnlineTransport WebOnline_Transport;

// The bridge is configured with WebOnline_Transport before main(). A wrapper
// around it (tests/online/web_client.c traces) is installed here, so that
// connect(), which hands the bridge the page's player name, keeps it.
void WebOnline_SetBridgeTransport(const OnlineTransport *t);

#endif
