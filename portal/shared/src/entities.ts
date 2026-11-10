// The registry of entity types: the kinds of record that a polymorphic reference (the pair
// `entityType` and `entityId`) can point at, with the path of each (docs/DATA_MODEL.md,
// section 1). Add a row here when a new kind of record can be referenced that way.
import { paths } from "./paths";
import { z } from "./zod";

/**
 * | Entity type | Document          | Identifier         |
 * |-------------|-------------------|--------------------|
 * | `user`      | `users/{uid}`     | Authentication uid |
 */
const ENTITY_PATHS = {
  user: paths.user,
} as const satisfies Record<string, (entityId: string) => string>;

export const ENTITY_TYPES = Object.keys(ENTITY_PATHS) as readonly EntityType[];
export type EntityType = keyof typeof ENTITY_PATHS;
export const entityTypeSchema = z.enum(Object.keys(ENTITY_PATHS) as [EntityType, ...EntityType[]]);

/** The path of the document that an entity reference points at. */
export function entityPath(entityType: EntityType, entityId: string): string {
  return ENTITY_PATHS[entityType](entityId);
}
