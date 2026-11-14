/** The ONLY place DynamoDB key strings are built (CLAUDE.md). Layout: PRD §6.2. */
const roomDay = (roomId: string, day: string) => `ROOM#${roomId}#DAY#${day}`;

export const keys = {
  building: (id: string) => ({ PK: `BLDG#${id}`, SK: 'META' }),
  room: (id: string) => ({ PK: `ROOM#${id}`, SK: 'META' }),
  roomDayPk: roomDay,
  classItem: (roomId: string, day: string, startIso: string, eventId: string) => ({
    PK: roomDay(roomId, day),
    SK: `CLASS#${startIso}#${eventId}`,
  }),
  syncMeta: (roomId: string, day: string) => ({ PK: roomDay(roomId, day), SK: 'SYNCMETA' }),
  reservation: (id: string) => ({ PK: `RES#${id}`, SK: 'META' }),
  resPk: (id: string) => `RES#${id}`,
  resEvent: (id: string, atIso: string, seq: number, eventId: string) => ({
    PK: `RES#${id}`,
    SK: `EVT#${atIso}#${seq}-${eventId}`,
  }),
  lock: (roomId: string, slotIso: string) => ({ PK: `ROOM#${roomId}#SLOT#${slotIso}`, SK: 'LOCK' }),
  user: (id: string) => ({ PK: `USER#${id}`, SK: 'PROFILE' }),
  quota: (id: string) => ({ PK: `USER#${id}`, SK: 'QUOTA' }),
  idempotency: (userId: string, key: string) => ({ PK: `IDEMP#${userId}#${key}`, SK: 'IDEMP' }),
  syncRun: (source: string, atIso: string) => ({ PK: `SYNC#${source}`, SK: `RUN#${atIso}` }),
  syncRunPk: (source: string) => `SYNC#${source}`,
  injectedClass: (eventId: string) => ({ PK: 'MOCK25LIVE', SK: `INJECT#${eventId}` }),
  injectedPk: 'MOCK25LIVE',

  // Secondary indexes
  gsi1: {
    catalog: 'CATALOG',
    buildingSk: (id: string) => `BLDG#${id}`,
    buildingPk: (id: string) => `BLDG#${id}`,
    roomSk: (id: string) => `ROOM#${id}`,
    resPk: roomDay,
    resSk: (startIso: string, id: string) => `RES#${startIso}#${id}`,
  },
  gsi2: {
    userPk: (id: string) => `USER#${id}`,
    resSk: (startIso: string) => `RES#${startIso}`,
  },

  prefix: {
    room: 'ROOM#',
    class: 'CLASS#',
    res: 'RES#',
    evt: 'EVT#',
    run: 'RUN#',
    inject: 'INJECT#',
  },
} as const;
