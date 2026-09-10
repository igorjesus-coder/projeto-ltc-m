export const P026_MIGRATION_COUNT = 19;

export function assertP026MigrationInventory(names) {
  if (names.length !== P026_MIGRATION_COUNT) {
    throw new Error(
      `P026_MIGRATION_INVENTORY_UNEXPECTED: expected ${P026_MIGRATION_COUNT}, received ${names.length}`,
    );
  }
}
