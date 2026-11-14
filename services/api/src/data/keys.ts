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
  /** Demo alias → userId map (Cognito subs when deployed); written by postDeploy. */
  demoIds: { PK: 'DEMO', SK: 'IDS' },

  // P3: identity, contact, claims, notifications
  userPrivate: (id: string) => ({ PK: `USER#${id}`, SK: 'PRIVATE' }),
  userPk: (id: string) => `USER#${id}`,
  uid: (hash: string) => ({ PK: `UID#${hash}`, SK: 'UID' }),
  claim: (resId: string, claimId: string) => ({ PK: `RES#${resId}`, SK: `CLAIM#${claimId}` }),
  openClaim: (resId: string, requesterId: string) => ({
    PK: `RES#${resId}`,
    SK: `OPENCLAIM#${requesterId}`,
  }),
  claimQuota: (userId: string) => ({ PK: `USER#${userId}`, SK: 'CLAIMQUOTA' }),
  reveal: (resId: string, requesterId: string) => ({
    PK: `RES#${resId}`,
    SK: `REVEAL#${requesterId}`,
  }),
  audit: (resId: string, atIso: string, id: string) => ({
    PK: `RES#${resId}`,
    SK: `AUDIT#${atIso}#${id}`,
  }),
  notification: (userId: string, notifId: string) => ({
    PK: `USER#${userId}`,
    SK: `NOTIF#${notifId}`,
  }),

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
    claimSk: (createdIso: string) => `CLAIM#${createdIso}`,
  },
  gsi3: {
    incomingPk: (ownerId: string) => `USER#${ownerId}#INCOMING`,
    claimSk: (createdIso: string) => `CLAIM#${createdIso}`,
  },
  gsi4: {
    sweepRes: 'SWEEP#RES',
    sweepClaim: 'SWEEP#CLAIM',
    sk: (dueIso: string, id: string) => `${dueIso}#${id}`,
    /** Upper bound for "due at or before now". */
    dueBy: (nowIso: string) => `${nowIso}#￿`,
  },

  prefix: {
    room: 'ROOM#',
    class: 'CLASS#',
    res: 'RES#',
    evt: 'EVT#',
    run: 'RUN#',
    inject: 'INJECT#',
    claim: 'CLAIM#',
    notif: 'NOTIF#',
    idemp: 'IDEMP#',
  },
} as const;
