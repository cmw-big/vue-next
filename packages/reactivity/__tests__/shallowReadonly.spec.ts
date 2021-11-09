import { isReactive, isReadonly, readonly, shallowReadonly } from '../src'

describe('reactivity/shallowReadonly', () => {
  test('should not make non-reactive properties reactive', () => {
    const props = shallowReadonly({ n: { foo: 1 } })
    expect(isReactive(props.n)).toBe(false)
  })

  test('should make root level properties readonly', () => {
    const props = shallowReadonly({ n: 1 })
    // @ts-ignore
    props.n = 2
    expect(props.n).toBe(1)
    expect(
      `Set operation on key "n" failed: target is readonly.`
    ).toHaveBeenWarned()
  })

  // to retain 2.x behavior.
  test('should NOT make nested properties readonly', () => {
    const props = shallowReadonly({ n: { foo: 1 } })
    // @ts-ignore
    props.n.foo = 2
    expect(props.n.foo).toBe(2)
    expect(
      `Set operation on key "foo" failed: target is readonly.`
    ).not.toHaveBeenWarned()
  })

  // #2843
  test('should differentiate from normal readonly calls', () => {
    const original = { foo: {} }
    const shallowProxy = shallowReadonly(original)
    const reactiveProxy = readonly(original)
    expect(shallowProxy).not.toBe(reactiveProxy)
    expect(isReadonly(shallowProxy.foo)).toBe(false)
    expect(isReadonly(reactiveProxy.foo)).toBe(true)
  })

  describe('collection/Map', () => {
    ;[Map, WeakMap].forEach(Collection => {
      test('should make the map/weak-map readonly', () => {
        const key = {}
        const val = { foo: 1 }
        const original = new Collection([[key, val]])
        const sroMap = shallowReadonly(original)
        expect(isReadonly(sroMap)).toBe(true)
        expect(isReactive(sroMap)).toBe(false)
        expect(sroMap.get(key)).toBe(val)

        sroMap.set(key, {} as any)
        expect(
          `Set operation on key "[object Object]" failed: target is readonly.`
        ).toHaveBeenWarned()
      })

      test('should not make nested values readonly', () => {
        const key = {}
        const val = { foo: 1 }
        const original = new Collection([[key, val]])
        const sroMap = shallowReadonly(original)
        expect(isReadonly(sroMap.get(key))).toBe(false)
        expect(isReactive(sroMap.get(key))).toBe(false)

        sroMap.get(key)!.foo = 2
        expect(
          `Set operation on key "foo" failed: target is readonly.`
        ).not.toHaveBeenWarned()
      })
    })

    test('should not make the value generated by the iterable method readonly', () => {
      const key = {}
      const val = { foo: 1 }
      const original = new Map([[key, val]])
      const sroMap = shallowReadonly(original)

      const values1 = [...sroMap.values()]
      const values2 = [...sroMap.entries()]

      expect(isReadonly(values1[0])).toBe(false)
      expect(isReactive(values1[0])).toBe(false)
      expect(values1[0]).toBe(val)

      values1[0].foo = 2
      expect(
        `Set operation on key "foo" failed: target is readonly.`
      ).not.toHaveBeenWarned()

      expect(isReadonly(values2[0][1])).toBe(false)
      expect(isReactive(values2[0][1])).toBe(false)
      expect(values2[0][1]).toBe(val)

      values2[0][1].foo = 2
      expect(
        `Set operation on key "foo" failed: target is readonly.`
      ).not.toHaveBeenWarned()
    })

    test('should not make the value generated by the forEach method readonly', () => {
      const val = { foo: 1 }
      const original = new Map([['key', val]])
      const sroMap = shallowReadonly(original)

      sroMap.forEach(val => {
        expect(isReadonly(val)).toBe(false)
        expect(isReactive(val)).toBe(false)
        expect(val).toBe(val)

        val.foo = 2
        expect(
          `Set operation on key "foo" failed: target is readonly.`
        ).not.toHaveBeenWarned()
      })
    })
  })

  describe('collection/Set', () => {
    test('should make the set/weak-set readonly', () => {
      ;[Set, WeakSet].forEach(Collection => {
        const obj = { foo: 1 }
        const original = new Collection([obj])
        const sroSet = shallowReadonly(original)
        expect(isReadonly(sroSet)).toBe(true)
        expect(isReactive(sroSet)).toBe(false)
        expect(sroSet.has(obj)).toBe(true)

        sroSet.add({} as any)
        expect(
          `Add operation on key "[object Object]" failed: target is readonly.`
        ).toHaveBeenWarned()
      })
    })

    test('should not make nested values readonly', () => {
      const obj = { foo: 1 }
      const original = new Set([obj])
      const sroSet = shallowReadonly(original)

      const values = [...sroSet.values()]

      expect(values[0]).toBe(obj)
      expect(isReadonly(values[0])).toBe(false)
      expect(isReactive(values[0])).toBe(false)

      sroSet.add({} as any)
      expect(
        `Add operation on key "[object Object]" failed: target is readonly.`
      ).toHaveBeenWarned()

      values[0].foo = 2
      expect(
        `Set operation on key "foo" failed: target is readonly.`
      ).not.toHaveBeenWarned()
    })

    test('should not make the value generated by the iterable method readonly', () => {
      const val = { foo: 1 }
      const original = new Set([val])
      const sroSet = shallowReadonly(original)

      const values1 = [...sroSet.values()]
      const values2 = [...sroSet.entries()]

      expect(isReadonly(values1[0])).toBe(false)
      expect(isReactive(values1[0])).toBe(false)
      expect(values1[0]).toBe(val)

      values1[0].foo = 2
      expect(
        `Set operation on key "foo" failed: target is readonly.`
      ).not.toHaveBeenWarned()

      expect(isReadonly(values2[0][1])).toBe(false)
      expect(isReactive(values2[0][1])).toBe(false)
      expect(values2[0][1]).toBe(val)

      values2[0][1].foo = 2
      expect(
        `Set operation on key "foo" failed: target is readonly.`
      ).not.toHaveBeenWarned()
    })

    test('should not make the value generated by the forEach method readonly', () => {
      const val = { foo: 1 }
      const original = new Set([val])
      const sroSet = shallowReadonly(original)

      sroSet.forEach(val => {
        expect(isReadonly(val)).toBe(false)
        expect(isReactive(val)).toBe(false)
        expect(val).toBe(val)

        val.foo = 2
        expect(
          `Set operation on key "foo" failed: target is readonly.`
        ).not.toHaveBeenWarned()
      })
    })
  })
})
