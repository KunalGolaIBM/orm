import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { db2TargetDescriptorMetaRuntime } from './runtime';

export const db2TargetDescriptorMeta = {
  ...db2TargetDescriptorMetaRuntime,
  defaultNamespaceId: UNBOUND_NAMESPACE_ID,
  supportsNamespaces: true,
} as const;

export default db2TargetDescriptorMeta;
