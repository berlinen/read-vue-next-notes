import { ErrorCodes, callWithErrorHandling } from './errorHandling'
import { isArray } from '@vue/shared'

export interface Job {
  (): void
  id?: number
}
// 执行 queueJob 时会把这个任务 job 添加到 queue 的队尾，而执行 queuePostFlushCb 时，会把这个 cb 回调函数添加到 postFlushCbs 的队尾。
// 异步队列任务
const queue: (Job | null)[] = []
// 队列任务执行完后执行的回调函数队列
const postFlushCbs: Function[] = []
// 声明一个promise
const p = Promise.resolve()
// Vue.js 内部还维护了 isFlushing 和 isFlushPending 变量，用来控制异步任务的刷新逻辑
// 异步任务队列是否正在执行
let isFlushing = false
// 异步任务队列是否等待执行
let isFlushPending = false

const RECURSION_LIMIT = 100
type CountMap = Map<Job | Function, number>
/**
 * 异步执行
 * @param fn
 */
export function nextTick(fn?: () => void): Promise<void> {
  return fn ? p.then(fn) : p
}
/**
 * @description
 * 执行 queueJob 时会把这个任务 job 添加到 queue 的队尾，
 * @param job
 */
export function queueJob(job: Job) {
  if (!queue.includes(job)) {
    queue.push(job)
    queueFlush()
  }
}

export function invalidateJob(job: Job) {
  const i = queue.indexOf(job)
  if (i > -1) {
    queue[i] = null
  }
}
/**
 * @description
 * 在不涉及 suspense 的情况下，queuePostRenderEffect 相当于 queuePostFlushCb
 * 执行 queuePostFlushCb 时，会把这个 cb 回调函数添加到 postFlushCbs 的队尾
 * @param cb
 */
export function queuePostFlushCb(cb: Function | Function[]) {
  if (!isArray(cb)) {
    postFlushCbs.push(cb)
  } else {
    // 如果是数组，把它拍平成一维
    postFlushCbs.push(...cb)
  }
  queueFlush()
}
/**
 * @description
 * 异步执行队列
 * 在 queueFlush 首次执行时，isFlushing 和 isFlushPending 都是 false，此时会把 isFlushPending 设置为 true，并且调用 nextTick(flushJobs) 去执行队列里的任务。
 */
function queueFlush() {
  if (!isFlushing && !isFlushPending) {
    // 等待执行
    isFlushPending = true
    // 调用 nextTick(flushJobs) 去执行队列里的任务

    // 因为 isFlushPending 的控制，这使得即使多次执行 queueFlush，也不会多次去执行 flushJobs。另外 nextTick 在 Vue.js 3.0 中的实现也是非常简单，通过 Promise.resolve().then 去异步执行 flushJobs。

    // 这样的异步设计使你在一个 Tick 内，可以多次执行 queueJob 或者 queuePostFlushCb 去添加任务，也可以保证在宏任务执行完毕后的微任务阶段执行一次 flushJobs。
    nextTick(flushJobs)
  }
}
/**
 * @description
 * 遍历执行所有推入到 postFlushCbs 的回调函数：
 * @param seen
 */
export function flushPostFlushCbs(seen?: CountMap) {
  if (postFlushCbs.length) {
    // // 拷贝副本
    // 这是因为在遍历的过程中，可能某些回调函数的执行会再次修改 postFlushCbs，所以拷贝一个副本循环遍历则不会受到 postFlushCbs 修改的影响。
    const cbs = [...new Set(postFlushCbs)]
    postFlushCbs.length = 0
    if (__DEV__) {
      seen = seen || new Map()
    }
    for (let i = 0; i < cbs.length; i++) {
      if (__DEV__) {
        checkRecursiveUpdates(seen!, cbs[i])
      }
      cbs[i]()
    }
  }
}
// 异步任务队列的执行

const getId = (job: Job) => (job.id == null ? Infinity : job.id)
// 要异步执行这个队列
/**
 * @description
 * 1. flushJobs 函数开始执行的时候，会把 isFlushPending 重置为 false，把 isFlushing 设置为 true 来表示正在执行异步任务队列
 *
 * 对于异步任务队列 queue，在遍历执行它们前会先对它们做一次从小到大的排序，这是因为两个主要原因：
 *
 *    1. 我们创建组件的过程是由父到子，所以创建组件副作用渲染函数也是先父后子，父组件的副作用渲染函数的 effect id 是小于子组件的，每次更新组件也是通过 queueJob 把 effect 推入异步任务队列 queue 中的。所以为了保证先更新父组再更新子组件，要对 queue 做从小到大的排序。
 *
 *    2. 如果一个组件在父组件更新过程中被卸载，它自身的更新应该被跳过。所以也应该要保证先更新父组件再更新子组件，要对 queue 做从小到大的排序。
 *
 * 2. 遍历这个 queue，依次执行队列中的任务了，在遍历过程中，注意有一个 checkRecursiveUpdates 的逻辑，，它是用来在非生产环境下检测是否有循环更新的
 *
 * 3. 遍历完 queue 后，又会进一步执行 flushPostFlushCbs 方法去遍历执行所有推入到 postFlushCbs 的回调函数：
 * @param seen
 */
function flushJobs(seen?: CountMap) {
  isFlushPending = false
  isFlushing = true
  let job
  if (__DEV__) {
    seen = seen || new Map()
  }

  // Sort queue before flush.
  // This ensures that:
  // 1. Components are updated from parent to child. (because parent is always
  //    created before the child so its render effect will have smaller
  //    priority number)
  // 2. If a component is unmounted during a parent component's update,
  //    its update can be skipped.
  // Jobs can never be null before flush starts, since they are only invalidated
  // during execution of another flushed job.

  // / 组件的更新是先父后子

  //  // 如果一个组件在父组件更新过程中卸载，它自身的更新应该被跳过
  queue.sort((a, b) => getId(a!) - getId(b!))

  while ((job = queue.shift()) !== undefined) {
    if (job === null) {
      continue
    }
    if (__DEV__) {
      // ，它是用来在非生产环境下检测是否有循环更新的
      checkRecursiveUpdates(seen!, job)
    }
    callWithErrorHandling(job, null, ErrorCodes.SCHEDULER)
  }
  // 遍历执行所有推入到 postFlushCbs 的回调函数：
  flushPostFlushCbs(seen)
  //// 异步任务队列是否正在执行
  isFlushing = false
  // some postFlushCb queued jobs!
  // keep flushing until it drains.
  // 一些 postFlushCb 执行过程中会再次添加异步任务，递归 flushJobs 会把它们都执行完毕
  if (queue.length || postFlushCbs.length) {
    flushJobs(seen)
  }
}
/**
 * @description
 * 检测循环更新
 *
 *通过前面的代码，我们知道 flushJobs 一开始便创建了 seen，它是一个 Map 对象，然后在 checkRecursiveUpdates 的时候会把任务添加到 seen 中，记录引用计数 count，初始值为 1，如果 postFlushCbs 再次添加了相同的任务，则引用计数 count 加 1，如果 count 大于我们定义的限制 100 ，则说明一直在添加这个相同的任务并超过了 100 次。那么，Vue.js 会抛出这个错误，因为在正常的使用中，不应该出现这种情况，而我们上述的错误示例就会触发这种报错逻辑。
 
 * @example
 *  import { reactive, watch } from 'vue'
    const state = reactive({ count: 0 })
    watch(() => state.count, (count, prevCount) => {
      state.count++
      console.log(count)
    })
    state.count++
    如果你去跑这个示例，你会在控制台看到输出了 101 次值，然后报了错误： Maximum recursive updates exceeded 。这是因为我们在 watcher 的回调函数里更新了数据，这样会再一次进入回调函数，如果我们不加任何控制，那么回调函数会一直执行，直到把内存耗尽造成浏览器假死。
    为了避免这种情况，Vue.js 实现了 checkRecursiveUpdates 方法：

 * @param seen
 * @param fn
 */
function checkRecursiveUpdates(seen: CountMap, fn: Job | Function) {
  if (!seen.has(fn)) {
    seen.set(fn, 1)
  } else {
    const count = seen.get(fn)!
    if (count > RECURSION_LIMIT) {
      throw new Error(
        'Maximum recursive updates exceeded. ' +
          "You may have code that is mutating state in your component's " +
          'render function or updated hook or watcher source function.'
      )
    } else {
      seen.set(fn, count + 1)
    }
  }
}
