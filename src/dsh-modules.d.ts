/**
 * Ambient types for host-only registration. The real packages are provided
 * by the web profile at runtime; this plugin does not vendor them.
 */
declare module '@deepseek-ai/dsh-settings' {
  export function settingsNamespace(name: string): string & { readonly __ns: unique symbol }
}

declare module '@deepseek-ai/schemastery' {
  interface Schema<T = unknown> {
    default(value: T): Schema<T>
    min(value: number): Schema<T>
    max(value: number): Schema<T>
  }

  interface Schemastery {
    object<S extends Record<string, Schema>>(shape: S): Schema
    string(): Schema<string>
    number(): Schema<number>
    boolean(): Schema<boolean>
    union<const T extends readonly unknown[]>(values: T): Schema<T[number]>
    dict<V>(inner: Schema<V>): Schema<Record<string, V>>
    array<V>(inner: Schema<V>): Schema<V[]>
  }

  const z: Schemastery
  export default z
  export type { Schema }
}
