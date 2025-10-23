import "reflect-metadata";
import type { Container } from "./container";
type ScanOptions = {
    autoBindUndecorated?: boolean;
    fallbackLifetime?: "singleton" | "scoped" | "transient";
};
export declare function scanModules(container: Container, modules: Record<string, any>[], opts?: ScanOptions): Promise<void>;
export {};
