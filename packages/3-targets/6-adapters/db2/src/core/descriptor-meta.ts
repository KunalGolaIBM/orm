export const db2AdapterDescriptorMeta = {
  kind: 'adapter',
  familyId: 'sql',
  targetId: 'db2',
  id: 'db2',
  version: '0.0.1',
  capabilities: {
    sql: {
      orderBy: true,
      limit: true,
      lateral: false,
      jsonAgg: false,
      returning: false,
      foreignKeys: true,
      enums: false,
      insertOnConflictSkip: false,
      insertOnConflictWithoutTarget: false,
    },
  },
} as const;
