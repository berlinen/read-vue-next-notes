## setup

child template

```vue
<template>
  <p>{{ msg }}</p>
  <button @click="onClick">Toggle</button>
</template>
<script>
  export default {
    props: {
      msg: String
    },
    setup (props, { emit }) {
      function onClick () {
        emit('toggle')
      }
      return {
        onClick
      }
    }
  }
</script>
```

parent template

```vue
<template>
  <HelloWorld @toggle="toggle" :msg="msg"></HelloWorld>
</template>
<script>
  import { ref } from 'vue'
  import HelloWorld from "./components/HelloWorld";
  export default {
    components: { HelloWorld },
    setup () {
      const msg = ref('Hello World')
      function toggle () {
        msg.value = msg.value === 'Hello World' ? 'Hello Vue' : 'Hello World'
      }
      return {
        toggle,
        msg
      }
    }
  }
</script>
```

可以看到，HelloWorld 子组件的 setup 函数接收两个参数，第一个参数 props 对应父组件传入的 props 数据，第二个参数 emit 是一个对象，实际上就是 setupContext。