import React, {Component} from 'react'
import ReactDom from 'react-dom'
import {keyBy, mapValues, mapToArrayByProp} from 'mapdosh'

import registerSwipeHandler from './register-swipe-handler'

const stopAnimation = nodeData => {
  const {animation} = nodeData
  if (animation) {
    animation.cancel()
    delete nodeData.animation
  }
}

const hasWebAnimations = !! document.createElement('div').animate

const setBoundingRect = (child, domRect) => {
  const {node} = child
  if (! node)
    return
  // this doesn't factor in transforms that may be happening
  // child.top = child.node.offsetTop
  const rect = node.getBoundingClientRect()

  // TODO: remove the (+ 1), the nodes position offset should be calculated
  //       by looking at its margin/padding/border etc.
  child.top = rect.top - domRect.top + 1
  child.left = rect.left - domRect.left
  child.bottom = rect.bottom - domRect.top + 1
}

const getBoundingRect = (node, domRect) => {
  const rect = node.getBoundingClientRect()
  return {
    // see previous TODO
    top: rect.top - domRect.top + 1,
    left: rect.left - domRect.left,
    bottom: rect.bottom - domRect.top + 1,
  }
}


export default class FlipMove extends Component {
  constructor() {
    super()
    this.state = { enabled: hasWebAnimations }
    // all non-deleting child elements by key
    this._children = null
    // child elements that are deleting by key
    this._deleting = new Map()
  }

  render() {
    const {typeName, onSwipe, onDragStart, onDragStop, duration, ...props} = this.props
    if (! this.state.enabled)
      return React.createElement(typeName, props, props.children)

    delete props.children
    this._duration = +duration

    if (onSwipe) {
      props.ref = element => {
        const container = ReactDom.findDOMNode(element)
        if (! container || container === this._container)
          return
        this._container = container
        registerSwipeHandler(container, onSwipe, onDragStart, onDragStop)
      }
    }

    return React.createElement(typeName, props, this.state.children)
  }

  /**
   * Create an element that wraps another and injects a ref that is used to
   * capture the child element.
   * @detail The `node` field in the returned object is not populated until
   *         after the injected `ref` has been run.
   * @return {Object} { element: React.Component, node: HTMLElement }
   */
  _createElement(element) {
    const ret = {}
    ret.element = React.cloneElement(element, {
      ref: refElement => {
        const node = ReactDom.findDOMNode(refElement)
        if (node)
          ret.node = node
      },
    })
    return ret
  }

  /**
   * Usually copying props into state is a bad idea, in this case we need
   * access to elements that have been removed so that the elements can be
   * preserved until their leaving animation has ended.
   */
  _initComponent(children) {
    this._children = mapValues(keyBy(children, 'key'), element => this._createElement(element))
    this.setState({ children: mapToArrayByProp(this._children, 'element') })
  }

  _getDom() {
    return this._dom || (this._dom = ReactDom.findDOMNode(this))
  }

  componentWillMount() {
    if (! this.state.enabled)
      return
    this._initComponent(this.props.children)
  }

  /**
   * When new props are received the children are diffed to find out which
   * nodes are moved/deleted/added, the positions of existing nodes are
   * recorded so they can be used by componentDidUpdate.
   */
  componentWillReceiveProps(props) {
    if (! this.state.enabled)
      return

    if (this.props.children === props.children)
      return

    this._hasNewProps = true
    const _dom = this._getDom()
    if (! this._children) {
      this._initComponent(props.children)
    }
    else {
      const newChildren = new Map()
      const domRect = _dom.getBoundingClientRect()

      props.children.forEach(element => {
        const {key} = element
        const existing = this._children.get(key)
        if (existing) {
          newChildren.set(key, existing)
          // recalculate bounding rectangle for existing node
          setBoundingRect(existing, domRect)
          return
        }

        const deleting = this._deleting.get(key)
        if (deleting) {
          newChildren.set(key, deleting)
          setBoundingRect(deleting, domRect)
          stopAnimation(deleting)
          deleting.node.style.zIndex = ''
          this._returnNodeToFlow(deleting)
          this._deleting.delete(key)
        }
        else {
          newChildren.set(key, this._createElement(element))
        }
      })

      this._children.forEach((child, key) => {
        if (! newChildren.has(key)) {
          setBoundingRect(child, domRect)
          this._deleting.set(key, child)
          child.node.style.zIndex = -1
        }
      })
      this._children = newChildren
      this._setChildren()
    }
  }

  _setChildren() {
    // the deletes must come after the rest so they don't interfere with the positions of other nodes
    this.setState({ children: mapToArrayByProp(this._children, 'element').concat(mapToArrayByProp(this._deleting, 'element')) })
  }

  /**
   * This is called by react after the DOM nodes are created but before the
   * browser has painted making it the ideal time to start animations.
   *
   * This works using a variation of the FLIP technique that used webanimations
   * instead of requestAnimationFrame. Essentially the node is given a
   * css transformation that translates it from its *new* position to its old
   * position. Then a web animation is started which will move the node to its
   * new position. Enter and leave animations are also handled here.
   */
  componentDidUpdate() {
    // avoid testing stuff when only state has changed
    if (!  this._hasNewProps)
      return

    const {scrollTop = document.body.scrollTop} = document.documentElement
    const domBoundingRect = this._dom.getBoundingClientRect()
    const maxHeight = window.innerHeight - domBoundingRect.top + scrollTop
    const width = this._dom.clientWidth
    const currentContainerHeight = scrollTop + window.innerHeight

    let nLeavesLeft = 0
    let deleteToken = null
    const leaveAnimationOver = () => {
      if (this._deleteToken !== deleteToken)
        return

      if (--nLeavesLeft <= 0) {
        // console.debug('all animations finished')
        this._dom.style.minHeight = ''
      }
    }

    this._children.forEach((data, key) => {
      const {node} = data
      if (! node)
        return

      const rect = getBoundingRect(node, domBoundingRect)
      if (data.hasOwnProperty('top')) {
        if (data.animation) {
          // TODO: should compare animateToTop to the desired location without
          // the transformation, this will never succeed
          if (data.animateToTop === rect.top && data.animateToLeft === rect.left)
            return
          data.animation.cancel()
          delete data.animation
        }

        // move from previous position
        const deltaX = data.left - rect.left
        const deltaY = data.top - rect.top

        if (deltaX !== 0 || deltaY !== 0) {
          // move node from current position to new position (if necessary)
          data.animateToTop = rect.top
          data.animateToLeft = rect.left
          data.animation = node.animate(
            [{ transform: `translate(${deltaX}px, ${deltaY}px)` }, { transform: `translate(0, 0)` }],
            // fill forwards is needed to compensate for delayed onfinish in firefox
            { duration: this._duration, easing: 'ease-in' }
          )
        }
      }
      else {
        // only animate nodes on screen
        if (rect.bottom < scrollTop || rect.top > maxHeight)
          return

        data.animateToTop = rect.top
        data.animateToLeft = rect.left - width
        // child has no recorded position so must be an entry
        data.animation = node.animate(
          [{ transform: `translateX(-${width}px)` }, { transform: `translateX(0)` }],
          { duration: this._duration, easing: 'ease-in' }
        )
      }
    })

    let hasImmediateLeaves = false
    let hasLeaves = false
    this._deleting.forEach((data, key) => {
      hasLeaves = true
      const {animation: existingAnimation} = data
      const finalX = data.left < 0 ? -width : width
      const newLeft = data.left + finalX

      if (existingAnimation &&
          data.animateToTop === data.top &&
          data.animateToLeft === newLeft)
        return

      const {node} = data
      // avoid animations for stuff scrolled off screen ;)
      if (data.bottom < scrollTop || data.top > maxHeight) {
        node.style.display = 'none'
        this._deleting.delete(key)
        hasImmediateLeaves = true
        return
      }

      this._takeNodeOutOfFlow(data)
      data.animateToTop = data.top
      data.animateToLeft = newLeft

      const animation = data.animation = node.animate(
        [{ transform: `translateX(${data.left}px)` }, { transform: `translateX(${finalX}px)` }],
        // fill forwards is needed to compensate for delayed onfinish in firefox
        { duration: this._duration, easing: 'ease-in', fill: 'forwards' }
      )
      ++nLeavesLeft

      animation.onfinish = () => {
        node.style.display = 'none'
        this._deleting.delete(key)
        this._setChildren()
        leaveAnimationOver()
      }

      animation.oncancel = leaveAnimationOver
    })

    if (hasImmediateLeaves)
      this._setChildren()

    if (hasLeaves) {
      this._dom.style.minHeight = currentContainerHeight + 'px'
      deleteToken = this._deleteToken = Symbol()
    }

    this._hasNewProps = false
  }

  /**
   * This is used to keep an HTMLElement where it was positioned but remove it from the
   * parent node's flow so that it does not contribute to height and the positioning of
   * other elements
   */
  _takeNodeOutOfFlow(data) {
    const {node} = data
    node.style.position = 'absolute'
    node.style.top = data.top + 'px'
  }

  // Undo _takeNodeOutOfFlow
  _returnNodeToFlow(data) {
    const {node} = data
    node.style.position = ''
    node.style.top = ''
  }
}
