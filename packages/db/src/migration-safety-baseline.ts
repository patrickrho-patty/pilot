export type MigrationSafetyBaselineEntry = {
  readonly id: string;
  readonly rule: string;
  readonly migration: string;
  readonly table: string;
  readonly reason: string;
};

export const MIGRATION_SAFETY_BASELINE: readonly MigrationSafetyBaselineEntry[] = [];
