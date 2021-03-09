## 计算属性 API： computed

example

```vue
<script>
  const count = ref(1);
  const plusOne = computed(() => count.vule++);
  console.log(plusOne.value); // 2
  plusOne.value++ // error
  count.value++
  console.log(plusOne.value) // 3
</script>
```

从代码中可以看到，我们先使用 ref API 创建了一个响应式对象 count，然后使用 computed API 创建了另一个响应式对象 plusOne，它的值是 count.value + 1，当我们修改 count.value 的时候， plusOne.value 就会自动发生变化。

注意，这里我们直接修改 plusOne.value 会报一个错误，这是因为如果我们传递给 computed 的是一个函数，那么这就是一个 getter 函数，我们只能获取它的值，而不能直接修改它。

在 getter 函数中，我们会根据响应式对象重新计算出新的值，这也就是它被叫做计算属性的原因，而这个响应式对象，就是计算属性的依赖。

有时候我们也希望能够直接修改 computed 的返回值，那么我们可以给 computed 传入一个对象：

```vue
<script>
  const count = ref(1)
  const plusOne = computed({
    get: () => count.value + 1,
    set: val => {
      count.value = val - 1
    }
  })
  plusOne.value = 1
  console.log(count.value) // 0
</script>
```

我们给 computed 函数传入了一个拥有 getter 函数和 setter 函数的对象，getter 函数和之前一样，还是返回 count.value + 1；而 setter 函数，请注意，这里我们修改 plusOne.value 的值就会触发 setter 函数，其实 setter 函数内部实际上会根据传入的参数修改计算属性的依赖值 count.value，因为一旦依赖的值被修改了，我们再去获取计算属性就会重新执行一遍 getter，所以这样获取的值也就发生了变化。