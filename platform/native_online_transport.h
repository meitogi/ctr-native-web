#ifndef NATIVE_ONLINE_TRANSPORT_H
#define NATIVE_ONLINE_TRANSPORT_H

// The only thing the OnlineCTR client bridge knows about the network.
// One payload per message: exactly the bytes ENet would carry.
// See docs/ONLINECTR_PORT.md, D3.

enum OnlineTransportEvent
{
	ONLINE_EVENT_NONE,
	ONLINE_EVENT_DATA,
	ONLINE_EVENT_CONNECTED,
	ONLINE_EVENT_DISCONNECTED,
};

typedef struct OnlineTransport
{
	// async: poll() reports CONNECTED or DISCONNECTED ; returns 0 when started
	int (*connect)(const char *address);

	// reliable = 1 is ENet RELIABLE, 0 is UNSEQUENCED
	void (*send)(const void *buf, int len, int reliable);

	// non-blocking: returns -1 when there is no event, else sets *event
	// and returns the payload length (0 for CONNECTED / DISCONNECTED)
	int (*poll)(void *buf, int cap, int *event);

	void (*disconnect)(void);
} OnlineTransport;

#ifdef NATIVE_ONLINE_HAS_ENET
extern const OnlineTransport NativeOnline_EnetTransport;
#endif
extern const OnlineTransport NativeOnline_LoopbackTransport;

#endif
