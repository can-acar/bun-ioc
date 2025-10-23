import "reflect-metadata";
import { Container, type Token } from "./container";
export declare const globalContainer: Container;
type ServiceOptions = {
    lifetime?: "singleton" | "scoped" | "transient";
    name?: string;
    tokenOverride?: Token<any>;
};
export declare function Service(opts?: ServiceOptions): <T extends {
    new (...args: any[]): any;
}>(target: T) => void;
export declare function Named(name: string): (target: any, propertyKey?: string | symbol, parameterIndex?: number) => void;
export declare function Inject<T>(tokenOrClass?: Token<T> | Function, name?: string): (target: any, propertyKey: string | symbol) => void;
export declare function InjectLazy<T>(tokenOrClass?: Token<T> | Function, name?: string): (target: any, propertyKey: string | symbol) => void;
export declare function InjectMethod(): (target: any, propertyKey: string, descriptor: PropertyDescriptor) => void;
export declare function NamedParam(name: string): (target: any, propertyKey: string, parameterIndex: number) => void;
export {};
