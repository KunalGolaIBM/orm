import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { CodecTypes } from '../exports/codec-types';
import { db2AuthoringFieldPresets, db2AuthoringTypes } from './authoring';
import { db2TargetDescriptorMetaRuntime } from './descriptor-meta-runtime';

const db2TargetDescriptorMetaBase = {
  ...db2TargetDescriptorMetaRuntime,
  defaultNamespaceId: UNBOUND_NAMESPACE_ID,
  supportsNamespaces: false,
  authoring: {
    type: db2AuthoringTypes,
    field: db2AuthoringFieldPresets,
  },
} as const;

export const db2TargetDescriptorMeta: typeof db2TargetDescriptorMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = db2TargetDescriptorMetaBase;
