// OnlineCTR server natively: sv_core.c behind ENet. Drop-in for upstream's
// SV_main.c main (-p / --port, -b / --banlist), to diff behaviour against
// the original server.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include "sv_enet.h"

static unsigned int NowMs(void)
{
	struct timespec ts;

	clock_gettime(CLOCK_MONOTONIC, &ts);
	return (unsigned int)(ts.tv_sec * 1000u + ts.tv_nsec / 1000000u);
}

static void ReadBanlist(const char *path)
{
	FILE *f = fopen(path, "r");
	char lineBuf[100];
	unsigned int lineNum = 1, banEntries = 0;

	if (!f)
	{
		printf("Unable to open banlist.txt\n");
		return;
	}

	while (fgets(lineBuf, sizeof(lineBuf), f))
	{
		int ip[4] = {0};
		unsigned char bytes[4];
		unsigned int packed;

		if (lineBuf[0] == '\n' && lineBuf[1] == '\0') //empty line
			;
		else if (sscanf(lineBuf, "%d.%d.%d.%d", &ip[0], &ip[1], &ip[2], &ip[3]) != 4)
			printf("Failiure to parse ipv4 address on line %u in banlist.txt.\n", lineNum);
		else
		{
			for (int i = 0; i < 4; i++)
				bytes[i] = (unsigned char)ip[i];
			memcpy(&packed, bytes, sizeof(packed));
			SvEnet_AddBan(packed);
			banEntries++;
		}
		lineNum++;
	}
	fclose(f);
	printf("Banlist initialized with %u entries.\n", banEntries);
}

int main(int argc, char **argv)
{
	int port = 64001;

	for (int i = 1; i < argc; i++)
	{
		if (strcmp(argv[i], "--port") == 0 || strcmp(argv[i], "-p") == 0)
		{
			if (i + 1 >= argc)
			{
				fprintf(stderr, "Error: --port or -p requires a value!\n");
				return 1;
			}
			port = atoi(argv[++i]);
		}
		else if (strcmp(argv[i], "--banlist") == 0 || strcmp(argv[i], "-b") == 0)
		{
			if (i + 1 >= argc)
			{
				fprintf(stderr, "Error: --banlist or -b requires a value!\n");
				return 1;
			}
			ReadBanlist(argv[++i]);
		}
	}

	if (SvEnet_Start(port) != 0)
		return 1;

	SvCore_Init(SvEnet_CoreHost());

	while (1)
	{
		usleep(1000);
		SvEnet_Service();
		SvCore_Tick(NowMs());
	}
}
