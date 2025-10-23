// @bun
// src/container.ts
class LazyLock {
  resolver;
  value;
  resolved = false;
  pending;
  constructor(resolver) {
    this.resolver = resolver;
  }
  async get() {
    if (this.resolved)
      return this.value;
    if (this.pending)
      return this.pending;
    const p = Promise.resolve(this.resolver()).then((v) => {
      this.value = v;
      this.resolved = true;
      this.pending = undefined;
      return v;
    });
    this.pending = p;
    return p;
  }
  getSync() {
    if (this.resolved)
      return this.value;
    const v = this.resolver();
    if (v instanceof Promise)
      throw new Error("Attempted sync resolve of async dependency");
    this.value = v;
    this.resolved = true;
    return v;
  }
}
var defaultPolicy = ({ candidates, requestedName, ctx }) => {
  const filtered = candidates.filter((r) => holds(r.when, ctx));
  if (requestedName) {
    const exact = filtered.find((r) => r.name === requestedName);
    return exact ?? undefined;
  }
  const def = filtered.find((r) => (r.name ?? "__default__") === "__default__");
  if (def)
    return def;
  if (filtered.length === 1)
    return filtered[0];
  return;
};
function holds(cond, ctx) {
  if (!cond)
    return true;
  switch (cond.type) {
    case "env": {
      const v = ctx.env[cond.key];
      if (cond.present)
        return v != null && v !== "";
      if (cond.equals != null)
        return v === cond.equals;
      if (cond.notEquals != null)
        return v !== cond.notEquals;
      return false;
    }
    case "flag": {
      const v = ctx.flags[cond.key];
      return cond.value == null ? Boolean(v) : v === cond.value;
    }
    case "profile":
      return ctx.profile === cond.name;
    case "fn":
      return !!cond.fn(ctx);
    default:
      return true;
  }
}

class Container {
  parent;
  map = new Map;
  _policy = defaultPolicy;
  ctx = {
    env: typeof process !== "undefined" && process.env ? process.env : {},
    flags: {},
    profile: undefined,
    now: () => Date.now()
  };
  constructor(parent) {
    this.parent = parent;
  }
  setFlags(flags) {
    Object.assign(this.ctx.flags, flags);
    return this;
  }
  setProfile(profile) {
    this.ctx.profile = profile;
    return this;
  }
  setEnv(env) {
    this.ctx.env = env;
    return this;
  }
  setResolutionPolicy(policy) {
    this._policy = policy;
    return this;
  }
  getContext() {
    return this.ctx;
  }
  mapKey(tok, name) {
    return `${tok.toString()}::${name ?? "__default__"}`;
  }
  listVariants(tok) {
    const prefix = `${tok.toString()}::`;
    return [...this.map.entries()].filter(([k]) => k.startsWith(prefix)).flatMap(([, arr]) => arr);
  }
  register(token, factory, lifetime = "transient", name, when) {
    const key = this.mapKey(token, name);
    const arr = this.map.get(key) ?? [];
    arr.push({ lifetime, factory, name, when });
    this.map.set(key, arr);
    return this;
  }
  registerAsync(token, asyncFactory, lifetime = "transient", name, when) {
    const key = this.mapKey(token, name);
    const arr = this.map.get(key) ?? [];
    arr.push({ lifetime, asyncFactory, name, when });
    this.map.set(key, arr);
    return this;
  }
  whenEnv(token, key, value, factory, lifetime = "singleton", name) {
    return this.register(token, factory, lifetime, name, { type: "env", key, equals: value });
  }
  whenFlag(token, key, expected, factory, lifetime = "singleton", name) {
    return this.register(token, factory, lifetime, name, { type: "flag", key, value: expected });
  }
  whenProfile(token, profile, factory, lifetime = "singleton", name) {
    return this.register(token, factory, lifetime, name, { type: "profile", name: profile });
  }
  when(token, pred, factory, lifetime = "singleton", name) {
    return this.register(token, factory, lifetime, name, { type: "fn", fn: pred });
  }
  resolve(token, name) {
    const reg = this.pickRegistration(token, name);
    if (!reg)
      throw new Error(`DI: ambiguous or missing ${token.toString()} [${name ?? "auto"}]`);
    if (reg.asyncFactory)
      throw new Error(`DI: ${token.toString()} is async, use resolveAsync()`);
    if (reg.resolving)
      throw new Error(`Circular dependency detected for ${token.toString()} [${reg.name ?? "auto"}]`);
    try {
      reg.resolving = true;
      if (reg.lifetime !== "transient") {
        if (reg.instance === undefined)
          reg.instance = reg.factory(this);
        return reg.instance;
      }
      return reg.factory(this);
    } finally {
      reg.resolving = false;
    }
  }
  async resolveAsync(token, name) {
    const reg = this.pickRegistration(token, name);
    if (!reg)
      throw new Error(`DI: ambiguous or missing ${token.toString()} [${name ?? "auto"}]`);
    if (reg.resolving)
      throw new Error(`Circular dependency detected for ${token.toString()} [${reg.name ?? "auto"}]`);
    try {
      reg.resolving = true;
      if (reg.asyncFactory) {
        if (reg.lifetime !== "transient") {
          if (reg.instance === undefined)
            reg.instance = await reg.asyncFactory(this);
          return reg.instance;
        }
        return await reg.asyncFactory(this);
      }
      return this.resolve(token, name);
    } finally {
      reg.resolving = false;
    }
  }
  resolveAll(token) {
    const regs = this.listVariants(token).filter((r) => holds(r.when, this.ctx));
    if (regs.length === 0 && this.parent)
      return this.parent.resolveAll(token);
    return regs.map((r) => {
      if (r.asyncFactory)
        throw new Error(`resolveAll: async binding present, use resolveAllAsync`);
      if (r.lifetime !== "transient") {
        if (r.instance === undefined)
          r.instance = r.factory(this);
        return r.instance;
      }
      return r.factory(this);
    });
  }
  async resolveAllAsync(token) {
    const regs = this.listVariants(token).filter((r) => holds(r.when, this.ctx));
    if (regs.length === 0 && this.parent)
      return await this.parent.resolveAllAsync(token);
    const out = [];
    for (const r of regs) {
      if (r.asyncFactory) {
        if (r.lifetime !== "transient") {
          if (r.instance === undefined)
            r.instance = await r.asyncFactory(this);
          out.push(r.instance);
        } else
          out.push(await r.asyncFactory(this));
      } else {
        out.push(this.resolve(token, r.name));
      }
    }
    return out;
  }
  resolveLazy(token, name) {
    const lock = new LazyLock(() => this.resolve(token, name));
    const sample = this.pickRegistration(token, name, true);
    if (!sample)
      throw new Error(`DI: ambiguous or missing ${token.toString()} [${name ?? "auto"}]`);
    return () => sample.lifetime === "transient" ? this.resolve(token, name) : lock.getSync();
  }
  resolveLazyAsync(token, name) {
    const lock = new LazyLock(() => this.resolveAsync(token, name));
    const sample = this.pickRegistration(token, name, true);
    if (!sample)
      throw new Error(`DI: ambiguous or missing ${token.toString()} [${name ?? "auto"}]`);
    return async () => sample.lifetime === "transient" ? await this.resolveAsync(token, name) : await lock.get();
  }
  injectLazy(token, name) {
    const lock = new LazyLock(() => this.resolve(token, name));
    const sample = this.pickRegistration(token, name, true);
    if (!sample)
      throw new Error(`DI: ambiguous or missing ${token.toString()} [${name ?? "auto"}]`);
    return {
      get: () => sample.lifetime === "transient" ? this.resolve(token, name) : lock.getSync(),
      enumerable: true,
      configurable: true
    };
  }
  createScope() {
    const child = new Container(this);
    child.setEnv(this.ctx.env);
    child.setFlags(this.ctx.flags);
    child.setProfile(this.ctx.profile);
    child.setResolutionPolicy(this._policy);
    return child;
  }
  pickRegistration(token, requestedName, searchParent = false) {
    const variants = this.listVariants(token);
    if (variants.length === 0 && this.parent && searchParent !== false)
      return this.parent.pickRegistration(token, requestedName, true);
    return this._policy({ token, candidates: variants, requestedName, ctx: this.ctx });
  }
}
var token = (desc) => Symbol.for(desc);

// node_modules/reflect-metadata/Reflect.js
/*! *****************************************************************************
Copyright (C) Microsoft. All rights reserved.
Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at http://www.apache.org/licenses/LICENSE-2.0

THIS CODE IS PROVIDED ON AN *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE,
MERCHANTABLITY OR NON-INFRINGEMENT.

See the Apache Version 2.0 License for specific language governing permissions
and limitations under the License.
***************************************************************************** */
var Reflect2;
(function(Reflect3) {
  (function(factory) {
    var root = typeof global === "object" ? global : typeof self === "object" ? self : typeof this === "object" ? this : Function("return this;")();
    var exporter = makeExporter(Reflect3);
    if (typeof root.Reflect === "undefined") {
      root.Reflect = Reflect3;
    } else {
      exporter = makeExporter(root.Reflect, exporter);
    }
    factory(exporter);
    function makeExporter(target, previous) {
      return function(key, value) {
        if (typeof target[key] !== "function") {
          Object.defineProperty(target, key, { configurable: true, writable: true, value });
        }
        if (previous)
          previous(key, value);
      };
    }
  })(function(exporter) {
    var hasOwn = Object.prototype.hasOwnProperty;
    var supportsSymbol = typeof Symbol === "function";
    var toPrimitiveSymbol = supportsSymbol && typeof Symbol.toPrimitive !== "undefined" ? Symbol.toPrimitive : "@@toPrimitive";
    var iteratorSymbol = supportsSymbol && typeof Symbol.iterator !== "undefined" ? Symbol.iterator : "@@iterator";
    var supportsCreate = typeof Object.create === "function";
    var supportsProto = { __proto__: [] } instanceof Array;
    var downLevel = !supportsCreate && !supportsProto;
    var HashMap = {
      create: supportsCreate ? function() {
        return MakeDictionary(Object.create(null));
      } : supportsProto ? function() {
        return MakeDictionary({ __proto__: null });
      } : function() {
        return MakeDictionary({});
      },
      has: downLevel ? function(map, key) {
        return hasOwn.call(map, key);
      } : function(map, key) {
        return key in map;
      },
      get: downLevel ? function(map, key) {
        return hasOwn.call(map, key) ? map[key] : undefined;
      } : function(map, key) {
        return map[key];
      }
    };
    var functionPrototype = Object.getPrototypeOf(Function);
    var usePolyfill = typeof process === "object" && process["env" + ""] && process["env" + ""]["REFLECT_METADATA_USE_MAP_POLYFILL"] === "true";
    var _Map = !usePolyfill && typeof Map === "function" && typeof Map.prototype.entries === "function" ? Map : CreateMapPolyfill();
    var _Set = !usePolyfill && typeof Set === "function" && typeof Set.prototype.entries === "function" ? Set : CreateSetPolyfill();
    var _WeakMap = !usePolyfill && typeof WeakMap === "function" ? WeakMap : CreateWeakMapPolyfill();
    var Metadata = new _WeakMap;
    function decorate(decorators, target, propertyKey, attributes) {
      if (!IsUndefined(propertyKey)) {
        if (!IsArray(decorators))
          throw new TypeError;
        if (!IsObject(target))
          throw new TypeError;
        if (!IsObject(attributes) && !IsUndefined(attributes) && !IsNull(attributes))
          throw new TypeError;
        if (IsNull(attributes))
          attributes = undefined;
        propertyKey = ToPropertyKey(propertyKey);
        return DecorateProperty(decorators, target, propertyKey, attributes);
      } else {
        if (!IsArray(decorators))
          throw new TypeError;
        if (!IsConstructor(target))
          throw new TypeError;
        return DecorateConstructor(decorators, target);
      }
    }
    exporter("decorate", decorate);
    function metadata(metadataKey, metadataValue) {
      function decorator(target, propertyKey) {
        if (!IsObject(target))
          throw new TypeError;
        if (!IsUndefined(propertyKey) && !IsPropertyKey(propertyKey))
          throw new TypeError;
        OrdinaryDefineOwnMetadata(metadataKey, metadataValue, target, propertyKey);
      }
      return decorator;
    }
    exporter("metadata", metadata);
    function defineMetadata(metadataKey, metadataValue, target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError;
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryDefineOwnMetadata(metadataKey, metadataValue, target, propertyKey);
    }
    exporter("defineMetadata", defineMetadata);
    function hasMetadata(metadataKey, target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError;
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryHasMetadata(metadataKey, target, propertyKey);
    }
    exporter("hasMetadata", hasMetadata);
    function hasOwnMetadata(metadataKey, target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError;
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryHasOwnMetadata(metadataKey, target, propertyKey);
    }
    exporter("hasOwnMetadata", hasOwnMetadata);
    function getMetadata(metadataKey, target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError;
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryGetMetadata(metadataKey, target, propertyKey);
    }
    exporter("getMetadata", getMetadata);
    function getOwnMetadata(metadataKey, target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError;
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryGetOwnMetadata(metadataKey, target, propertyKey);
    }
    exporter("getOwnMetadata", getOwnMetadata);
    function getMetadataKeys(target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError;
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryMetadataKeys(target, propertyKey);
    }
    exporter("getMetadataKeys", getMetadataKeys);
    function getOwnMetadataKeys(target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError;
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      return OrdinaryOwnMetadataKeys(target, propertyKey);
    }
    exporter("getOwnMetadataKeys", getOwnMetadataKeys);
    function deleteMetadata(metadataKey, target, propertyKey) {
      if (!IsObject(target))
        throw new TypeError;
      if (!IsUndefined(propertyKey))
        propertyKey = ToPropertyKey(propertyKey);
      var metadataMap = GetOrCreateMetadataMap(target, propertyKey, false);
      if (IsUndefined(metadataMap))
        return false;
      if (!metadataMap.delete(metadataKey))
        return false;
      if (metadataMap.size > 0)
        return true;
      var targetMetadata = Metadata.get(target);
      targetMetadata.delete(propertyKey);
      if (targetMetadata.size > 0)
        return true;
      Metadata.delete(target);
      return true;
    }
    exporter("deleteMetadata", deleteMetadata);
    function DecorateConstructor(decorators, target) {
      for (var i = decorators.length - 1;i >= 0; --i) {
        var decorator = decorators[i];
        var decorated = decorator(target);
        if (!IsUndefined(decorated) && !IsNull(decorated)) {
          if (!IsConstructor(decorated))
            throw new TypeError;
          target = decorated;
        }
      }
      return target;
    }
    function DecorateProperty(decorators, target, propertyKey, descriptor) {
      for (var i = decorators.length - 1;i >= 0; --i) {
        var decorator = decorators[i];
        var decorated = decorator(target, propertyKey, descriptor);
        if (!IsUndefined(decorated) && !IsNull(decorated)) {
          if (!IsObject(decorated))
            throw new TypeError;
          descriptor = decorated;
        }
      }
      return descriptor;
    }
    function GetOrCreateMetadataMap(O, P, Create) {
      var targetMetadata = Metadata.get(O);
      if (IsUndefined(targetMetadata)) {
        if (!Create)
          return;
        targetMetadata = new _Map;
        Metadata.set(O, targetMetadata);
      }
      var metadataMap = targetMetadata.get(P);
      if (IsUndefined(metadataMap)) {
        if (!Create)
          return;
        metadataMap = new _Map;
        targetMetadata.set(P, metadataMap);
      }
      return metadataMap;
    }
    function OrdinaryHasMetadata(MetadataKey, O, P) {
      var hasOwn2 = OrdinaryHasOwnMetadata(MetadataKey, O, P);
      if (hasOwn2)
        return true;
      var parent = OrdinaryGetPrototypeOf(O);
      if (!IsNull(parent))
        return OrdinaryHasMetadata(MetadataKey, parent, P);
      return false;
    }
    function OrdinaryHasOwnMetadata(MetadataKey, O, P) {
      var metadataMap = GetOrCreateMetadataMap(O, P, false);
      if (IsUndefined(metadataMap))
        return false;
      return ToBoolean(metadataMap.has(MetadataKey));
    }
    function OrdinaryGetMetadata(MetadataKey, O, P) {
      var hasOwn2 = OrdinaryHasOwnMetadata(MetadataKey, O, P);
      if (hasOwn2)
        return OrdinaryGetOwnMetadata(MetadataKey, O, P);
      var parent = OrdinaryGetPrototypeOf(O);
      if (!IsNull(parent))
        return OrdinaryGetMetadata(MetadataKey, parent, P);
      return;
    }
    function OrdinaryGetOwnMetadata(MetadataKey, O, P) {
      var metadataMap = GetOrCreateMetadataMap(O, P, false);
      if (IsUndefined(metadataMap))
        return;
      return metadataMap.get(MetadataKey);
    }
    function OrdinaryDefineOwnMetadata(MetadataKey, MetadataValue, O, P) {
      var metadataMap = GetOrCreateMetadataMap(O, P, true);
      metadataMap.set(MetadataKey, MetadataValue);
    }
    function OrdinaryMetadataKeys(O, P) {
      var ownKeys = OrdinaryOwnMetadataKeys(O, P);
      var parent = OrdinaryGetPrototypeOf(O);
      if (parent === null)
        return ownKeys;
      var parentKeys = OrdinaryMetadataKeys(parent, P);
      if (parentKeys.length <= 0)
        return ownKeys;
      if (ownKeys.length <= 0)
        return parentKeys;
      var set = new _Set;
      var keys = [];
      for (var _i = 0, ownKeys_1 = ownKeys;_i < ownKeys_1.length; _i++) {
        var key = ownKeys_1[_i];
        var hasKey = set.has(key);
        if (!hasKey) {
          set.add(key);
          keys.push(key);
        }
      }
      for (var _a = 0, parentKeys_1 = parentKeys;_a < parentKeys_1.length; _a++) {
        var key = parentKeys_1[_a];
        var hasKey = set.has(key);
        if (!hasKey) {
          set.add(key);
          keys.push(key);
        }
      }
      return keys;
    }
    function OrdinaryOwnMetadataKeys(O, P) {
      var keys = [];
      var metadataMap = GetOrCreateMetadataMap(O, P, false);
      if (IsUndefined(metadataMap))
        return keys;
      var keysObj = metadataMap.keys();
      var iterator = GetIterator(keysObj);
      var k = 0;
      while (true) {
        var next = IteratorStep(iterator);
        if (!next) {
          keys.length = k;
          return keys;
        }
        var nextValue = IteratorValue(next);
        try {
          keys[k] = nextValue;
        } catch (e) {
          try {
            IteratorClose(iterator);
          } finally {
            throw e;
          }
        }
        k++;
      }
    }
    function Type(x) {
      if (x === null)
        return 1;
      switch (typeof x) {
        case "undefined":
          return 0;
        case "boolean":
          return 2;
        case "string":
          return 3;
        case "symbol":
          return 4;
        case "number":
          return 5;
        case "object":
          return x === null ? 1 : 6;
        default:
          return 6;
      }
    }
    function IsUndefined(x) {
      return x === undefined;
    }
    function IsNull(x) {
      return x === null;
    }
    function IsSymbol(x) {
      return typeof x === "symbol";
    }
    function IsObject(x) {
      return typeof x === "object" ? x !== null : typeof x === "function";
    }
    function ToPrimitive(input, PreferredType) {
      switch (Type(input)) {
        case 0:
          return input;
        case 1:
          return input;
        case 2:
          return input;
        case 3:
          return input;
        case 4:
          return input;
        case 5:
          return input;
      }
      var hint = PreferredType === 3 ? "string" : PreferredType === 5 ? "number" : "default";
      var exoticToPrim = GetMethod(input, toPrimitiveSymbol);
      if (exoticToPrim !== undefined) {
        var result = exoticToPrim.call(input, hint);
        if (IsObject(result))
          throw new TypeError;
        return result;
      }
      return OrdinaryToPrimitive(input, hint === "default" ? "number" : hint);
    }
    function OrdinaryToPrimitive(O, hint) {
      if (hint === "string") {
        var toString_1 = O.toString;
        if (IsCallable(toString_1)) {
          var result = toString_1.call(O);
          if (!IsObject(result))
            return result;
        }
        var valueOf = O.valueOf;
        if (IsCallable(valueOf)) {
          var result = valueOf.call(O);
          if (!IsObject(result))
            return result;
        }
      } else {
        var valueOf = O.valueOf;
        if (IsCallable(valueOf)) {
          var result = valueOf.call(O);
          if (!IsObject(result))
            return result;
        }
        var toString_2 = O.toString;
        if (IsCallable(toString_2)) {
          var result = toString_2.call(O);
          if (!IsObject(result))
            return result;
        }
      }
      throw new TypeError;
    }
    function ToBoolean(argument) {
      return !!argument;
    }
    function ToString(argument) {
      return "" + argument;
    }
    function ToPropertyKey(argument) {
      var key = ToPrimitive(argument, 3);
      if (IsSymbol(key))
        return key;
      return ToString(key);
    }
    function IsArray(argument) {
      return Array.isArray ? Array.isArray(argument) : argument instanceof Object ? argument instanceof Array : Object.prototype.toString.call(argument) === "[object Array]";
    }
    function IsCallable(argument) {
      return typeof argument === "function";
    }
    function IsConstructor(argument) {
      return typeof argument === "function";
    }
    function IsPropertyKey(argument) {
      switch (Type(argument)) {
        case 3:
          return true;
        case 4:
          return true;
        default:
          return false;
      }
    }
    function GetMethod(V, P) {
      var func = V[P];
      if (func === undefined || func === null)
        return;
      if (!IsCallable(func))
        throw new TypeError;
      return func;
    }
    function GetIterator(obj) {
      var method = GetMethod(obj, iteratorSymbol);
      if (!IsCallable(method))
        throw new TypeError;
      var iterator = method.call(obj);
      if (!IsObject(iterator))
        throw new TypeError;
      return iterator;
    }
    function IteratorValue(iterResult) {
      return iterResult.value;
    }
    function IteratorStep(iterator) {
      var result = iterator.next();
      return result.done ? false : result;
    }
    function IteratorClose(iterator) {
      var f = iterator["return"];
      if (f)
        f.call(iterator);
    }
    function OrdinaryGetPrototypeOf(O) {
      var proto = Object.getPrototypeOf(O);
      if (typeof O !== "function" || O === functionPrototype)
        return proto;
      if (proto !== functionPrototype)
        return proto;
      var prototype = O.prototype;
      var prototypeProto = prototype && Object.getPrototypeOf(prototype);
      if (prototypeProto == null || prototypeProto === Object.prototype)
        return proto;
      var constructor = prototypeProto.constructor;
      if (typeof constructor !== "function")
        return proto;
      if (constructor === O)
        return proto;
      return constructor;
    }
    function CreateMapPolyfill() {
      var cacheSentinel = {};
      var arraySentinel = [];
      var MapIterator = function() {
        function MapIterator2(keys, values, selector) {
          this._index = 0;
          this._keys = keys;
          this._values = values;
          this._selector = selector;
        }
        MapIterator2.prototype["@@iterator"] = function() {
          return this;
        };
        MapIterator2.prototype[iteratorSymbol] = function() {
          return this;
        };
        MapIterator2.prototype.next = function() {
          var index = this._index;
          if (index >= 0 && index < this._keys.length) {
            var result = this._selector(this._keys[index], this._values[index]);
            if (index + 1 >= this._keys.length) {
              this._index = -1;
              this._keys = arraySentinel;
              this._values = arraySentinel;
            } else {
              this._index++;
            }
            return { value: result, done: false };
          }
          return { value: undefined, done: true };
        };
        MapIterator2.prototype.throw = function(error) {
          if (this._index >= 0) {
            this._index = -1;
            this._keys = arraySentinel;
            this._values = arraySentinel;
          }
          throw error;
        };
        MapIterator2.prototype.return = function(value) {
          if (this._index >= 0) {
            this._index = -1;
            this._keys = arraySentinel;
            this._values = arraySentinel;
          }
          return { value, done: true };
        };
        return MapIterator2;
      }();
      return function() {
        function Map2() {
          this._keys = [];
          this._values = [];
          this._cacheKey = cacheSentinel;
          this._cacheIndex = -2;
        }
        Object.defineProperty(Map2.prototype, "size", {
          get: function() {
            return this._keys.length;
          },
          enumerable: true,
          configurable: true
        });
        Map2.prototype.has = function(key) {
          return this._find(key, false) >= 0;
        };
        Map2.prototype.get = function(key) {
          var index = this._find(key, false);
          return index >= 0 ? this._values[index] : undefined;
        };
        Map2.prototype.set = function(key, value) {
          var index = this._find(key, true);
          this._values[index] = value;
          return this;
        };
        Map2.prototype.delete = function(key) {
          var index = this._find(key, false);
          if (index >= 0) {
            var size = this._keys.length;
            for (var i = index + 1;i < size; i++) {
              this._keys[i - 1] = this._keys[i];
              this._values[i - 1] = this._values[i];
            }
            this._keys.length--;
            this._values.length--;
            if (key === this._cacheKey) {
              this._cacheKey = cacheSentinel;
              this._cacheIndex = -2;
            }
            return true;
          }
          return false;
        };
        Map2.prototype.clear = function() {
          this._keys.length = 0;
          this._values.length = 0;
          this._cacheKey = cacheSentinel;
          this._cacheIndex = -2;
        };
        Map2.prototype.keys = function() {
          return new MapIterator(this._keys, this._values, getKey);
        };
        Map2.prototype.values = function() {
          return new MapIterator(this._keys, this._values, getValue);
        };
        Map2.prototype.entries = function() {
          return new MapIterator(this._keys, this._values, getEntry);
        };
        Map2.prototype["@@iterator"] = function() {
          return this.entries();
        };
        Map2.prototype[iteratorSymbol] = function() {
          return this.entries();
        };
        Map2.prototype._find = function(key, insert) {
          if (this._cacheKey !== key) {
            this._cacheIndex = this._keys.indexOf(this._cacheKey = key);
          }
          if (this._cacheIndex < 0 && insert) {
            this._cacheIndex = this._keys.length;
            this._keys.push(key);
            this._values.push(undefined);
          }
          return this._cacheIndex;
        };
        return Map2;
      }();
      function getKey(key, _) {
        return key;
      }
      function getValue(_, value) {
        return value;
      }
      function getEntry(key, value) {
        return [key, value];
      }
    }
    function CreateSetPolyfill() {
      return function() {
        function Set2() {
          this._map = new _Map;
        }
        Object.defineProperty(Set2.prototype, "size", {
          get: function() {
            return this._map.size;
          },
          enumerable: true,
          configurable: true
        });
        Set2.prototype.has = function(value) {
          return this._map.has(value);
        };
        Set2.prototype.add = function(value) {
          return this._map.set(value, value), this;
        };
        Set2.prototype.delete = function(value) {
          return this._map.delete(value);
        };
        Set2.prototype.clear = function() {
          this._map.clear();
        };
        Set2.prototype.keys = function() {
          return this._map.keys();
        };
        Set2.prototype.values = function() {
          return this._map.values();
        };
        Set2.prototype.entries = function() {
          return this._map.entries();
        };
        Set2.prototype["@@iterator"] = function() {
          return this.keys();
        };
        Set2.prototype[iteratorSymbol] = function() {
          return this.keys();
        };
        return Set2;
      }();
    }
    function CreateWeakMapPolyfill() {
      var UUID_SIZE = 16;
      var keys = HashMap.create();
      var rootKey = CreateUniqueKey();
      return function() {
        function WeakMap2() {
          this._key = CreateUniqueKey();
        }
        WeakMap2.prototype.has = function(target) {
          var table = GetOrCreateWeakMapTable(target, false);
          return table !== undefined ? HashMap.has(table, this._key) : false;
        };
        WeakMap2.prototype.get = function(target) {
          var table = GetOrCreateWeakMapTable(target, false);
          return table !== undefined ? HashMap.get(table, this._key) : undefined;
        };
        WeakMap2.prototype.set = function(target, value) {
          var table = GetOrCreateWeakMapTable(target, true);
          table[this._key] = value;
          return this;
        };
        WeakMap2.prototype.delete = function(target) {
          var table = GetOrCreateWeakMapTable(target, false);
          return table !== undefined ? delete table[this._key] : false;
        };
        WeakMap2.prototype.clear = function() {
          this._key = CreateUniqueKey();
        };
        return WeakMap2;
      }();
      function CreateUniqueKey() {
        var key;
        do
          key = "@@WeakMap@@" + CreateUUID();
        while (HashMap.has(keys, key));
        keys[key] = true;
        return key;
      }
      function GetOrCreateWeakMapTable(target, create) {
        if (!hasOwn.call(target, rootKey)) {
          if (!create)
            return;
          Object.defineProperty(target, rootKey, { value: HashMap.create() });
        }
        return target[rootKey];
      }
      function FillRandomBytes(buffer, size) {
        for (var i = 0;i < size; ++i)
          buffer[i] = Math.random() * 255 | 0;
        return buffer;
      }
      function GenRandomBytes(size) {
        if (typeof Uint8Array === "function") {
          if (typeof crypto !== "undefined")
            return crypto.getRandomValues(new Uint8Array(size));
          if (typeof msCrypto !== "undefined")
            return msCrypto.getRandomValues(new Uint8Array(size));
          return FillRandomBytes(new Uint8Array(size), size);
        }
        return FillRandomBytes(new Array(size), size);
      }
      function CreateUUID() {
        var data = GenRandomBytes(UUID_SIZE);
        data[6] = data[6] & 79 | 64;
        data[8] = data[8] & 191 | 128;
        var result = "";
        for (var offset = 0;offset < UUID_SIZE; ++offset) {
          var byte = data[offset];
          if (offset === 4 || offset === 6 || offset === 8)
            result += "-";
          if (byte < 16)
            result += "0";
          result += byte.toString(16).toLowerCase();
        }
        return result;
      }
    }
    function MakeDictionary(obj) {
      obj.__ = undefined;
      delete obj.__;
      return obj;
    }
  });
})(Reflect2 || (Reflect2 = {}));

// src/module-scanner.ts
async function scanModules(container, modules, opts = {}) {
  const { autoBindUndecorated = false, fallbackLifetime = "singleton" } = opts;
  const ctx = container.getContext();
  for (const mod of modules) {
    if (typeof mod.configure === "function") {
      const ret = mod.configure(container, ctx);
      if (ret instanceof Promise)
        await ret;
    }
    for (const [exportName, exp] of Object.entries(mod)) {
      if (typeof exp !== "function")
        continue;
      if (!isClass(exp))
        continue;
      const hasToken = Reflect.hasMetadata("di:token", exp);
      if (hasToken)
        continue;
      if (autoBindUndecorated) {
        const t = token(exp.name || exportName);
        container.register(t, (c) => {
          const paramTypes = Reflect.getMetadata("design:paramtypes", exp) || [];
          const params = paramTypes.map((p) => c.resolve(token(p.name)));
          return new exp(...params);
        }, fallbackLifetime);
        Reflect.defineMetadata("di:token", t, exp);
      }
    }
  }
}
function isClass(fn) {
  return typeof fn === "function" && /^class\s/.test(Function.prototype.toString.call(fn));
}
export {
  scanModules
};
