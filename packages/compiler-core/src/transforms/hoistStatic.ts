import {
  RootNode,
  NodeTypes,
  TemplateChildNode,
  SimpleExpressionNode,
  ElementTypes,
  PlainElementNode,
  ComponentNode,
  TemplateNode,
  ElementNode,
  VNodeCall
} from '../ast'
import { TransformContext } from '../transform'
import { PatchFlags, isString, isSymbol } from '@vue/shared'
import { isSlotOutlet, findProp } from '../utils'
/**
 * @description
 * 它的创建是在 render 函数外部执行的。
这样做的好处是，不用每次在 render 阶段都执行一次 createVNode 创建 vnode 对象，直接用之前在内存中创建好的 vnode 即可。

那么为什么叫静态提升呢？

因为这些静态节点不依赖动态数据，一旦创建了就不会改变，所以只有静态节点才能被提升到外部创建。
 * 静态提升的实现：

 * hoistStatic 主要就是从根节点开始，通过递归的方式去遍历节点，只有普通元素和文本节点才能被静态提升，所以针对这些节点，这里通过 getStaticType 去获取静态类型，如果节点是一个元素类型，getStaticType 内部还会递归判断它的子节点的静态类型。

 虽然有的节点包含一些动态子节点，但它本身的静态属性还是可以被静态提升的。

 如果 getStaticType 返回的 staticType 的值是 2，则表明它是一个运行时常量，由于它的值在运行时才能被确定，所以是不能静态提升的。

 createRootCodegen 创建根节点的代码生成节

 createRootCodegen 做的事情很简单，就是为 root 这个虚拟的 AST 根节点创建一个代码生成节点，如果 root 的子节点 children 是单个元素节点，则将其转换成一个 Block，把这个 child 的 codegenNode 赋值给 root 的 codegenNode。

 如果 root 的子节点 children 是多个节点，则返回一个 fragement 的代码生成节点，并赋值给 root 的 codegenNode。、、、、

 这里，创建 codegenNode 就是为了后续生成代码时使用。
 * @param root
 * @param context
 */
export function hoistStatic(root: RootNode, context: TransformContext) {
  walk(
    root.children,
    context,
    new Map(),
    // Root node is unfortuantely non-hoistable due to potential parent
    // fallthrough attributes.
    isSingleElementRoot(root, root.children[0])
  )
}

export function isSingleElementRoot(
  root: RootNode,
  child: TemplateChildNode
): child is PlainElementNode | ComponentNode | TemplateNode {
  const { children } = root
  return (
    children.length === 1 &&
    child.type === NodeTypes.ELEMENT &&
    !isSlotOutlet(child)
  )
}

function walk(
  children: TemplateChildNode[],
  context: TransformContext,
  resultCache: Map<TemplateChildNode, boolean>,
  doNotHoistNode: boolean = false
) {
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    // only plain elements are eligible for hoisting.
    if (
      child.type === NodeTypes.ELEMENT &&
      child.tagType === ElementTypes.ELEMENT
    ) {
      if (!doNotHoistNode && isStaticNode(child, resultCache)) {
        // whole tree is static
        ;(child.codegenNode as VNodeCall).patchFlag =
          PatchFlags.HOISTED + (__DEV__ ? ` /* HOISTED */` : ``)
        const hoisted = context.transformHoist
          ? context.transformHoist(child, context)
          : child.codegenNode!
        child.codegenNode = context.hoist(hoisted)
        continue
      } else {
        // node may contain dynamic children, but its props may be eligible for
        // hoisting.
        const codegenNode = child.codegenNode!
        if (codegenNode.type === NodeTypes.VNODE_CALL) {
          const flag = getPatchFlag(codegenNode)
          if (
            (!flag ||
              flag === PatchFlags.NEED_PATCH ||
              flag === PatchFlags.TEXT) &&
            !hasDynamicKeyOrRef(child) &&
            !hasCachedProps(child)
          ) {
            const props = getNodeProps(child)
            if (props) {
              codegenNode.props = context.hoist(props)
            }
          }
        }
      }
    }
    if (child.type === NodeTypes.ELEMENT) {
      walk(child.children, context, resultCache)
    } else if (child.type === NodeTypes.FOR) {
      // Do not hoist v-for single child because it has to be a block
      walk(child.children, context, resultCache, child.children.length === 1)
    } else if (child.type === NodeTypes.IF) {
      for (let i = 0; i < child.branches.length; i++) {
        const branchChildren = child.branches[i].children
        // Do not hoist v-if single child because it has to be a block
        walk(branchChildren, context, resultCache, branchChildren.length === 1)
      }
    } else if (
      child.type === NodeTypes.TEXT_CALL &&
      isStaticNode(child.content, resultCache)
    ) {
      child.codegenNode = context.hoist(child.codegenNode)
    }
  }
}

export function isStaticNode(
  node: TemplateChildNode | SimpleExpressionNode,
  resultCache: Map<TemplateChildNode, boolean> = new Map()
): boolean {
  switch (node.type) {
    case NodeTypes.ELEMENT:
      if (node.tagType !== ElementTypes.ELEMENT) {
        return false
      }
      const cached = resultCache.get(node)
      if (cached !== undefined) {
        return cached
      }
      const codegenNode = node.codegenNode!
      if (codegenNode.type !== NodeTypes.VNODE_CALL) {
        return false
      }
      const flag = getPatchFlag(codegenNode)
      if (!flag && !hasDynamicKeyOrRef(node) && !hasCachedProps(node)) {
        // element self is static. check its children.
        for (let i = 0; i < node.children.length; i++) {
          if (!isStaticNode(node.children[i], resultCache)) {
            resultCache.set(node, false)
            return false
          }
        }
        // only svg/foreignObject could be block here, however if they are static
        // then they don't need to be blocks since there will be no nested
        // updates.
        if (codegenNode.isBlock) {
          codegenNode.isBlock = false
        }
        resultCache.set(node, true)
        return true
      } else {
        resultCache.set(node, false)
        return false
      }
    case NodeTypes.TEXT:
    case NodeTypes.COMMENT:
      return true
    case NodeTypes.IF:
    case NodeTypes.FOR:
    case NodeTypes.IF_BRANCH:
      return false
    case NodeTypes.INTERPOLATION:
    case NodeTypes.TEXT_CALL:
      return isStaticNode(node.content, resultCache)
    case NodeTypes.SIMPLE_EXPRESSION:
      return node.isConstant
    case NodeTypes.COMPOUND_EXPRESSION:
      return node.children.every(child => {
        return (
          isString(child) || isSymbol(child) || isStaticNode(child, resultCache)
        )
      })
    default:
      if (__DEV__) {
        const exhaustiveCheck: never = node
        exhaustiveCheck
      }
      return false
  }
}

function hasDynamicKeyOrRef(node: ElementNode): boolean {
  return !!(findProp(node, 'key', true) || findProp(node, 'ref', true))
}

function hasCachedProps(node: PlainElementNode): boolean {
  if (__BROWSER__) {
    return false
  }
  const props = getNodeProps(node)
  if (props && props.type === NodeTypes.JS_OBJECT_EXPRESSION) {
    const { properties } = props
    for (let i = 0; i < properties.length; i++) {
      const val = properties[i].value
      if (val.type === NodeTypes.JS_CACHE_EXPRESSION) {
        return true
      }
      // merged event handlers
      if (
        val.type === NodeTypes.JS_ARRAY_EXPRESSION &&
        val.elements.some(
          e => !isString(e) && e.type === NodeTypes.JS_CACHE_EXPRESSION
        )
      ) {
        return true
      }
    }
  }
  return false
}

function getNodeProps(node: PlainElementNode) {
  const codegenNode = node.codegenNode!
  if (codegenNode.type === NodeTypes.VNODE_CALL) {
    return codegenNode.props
  }
}

function getPatchFlag(node: VNodeCall): number | undefined {
  const flag = node.patchFlag
  return flag ? parseInt(flag, 10) : undefined
}
