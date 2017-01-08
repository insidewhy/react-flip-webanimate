// swipe configuration
const MIN_DRAG_DISTANCE = 15
const N_STORE_VELOCITIES = 20
// consider a drag has taken place when the weighted mean of the velocities
// recorded within DRAG_VELOCITY_WINDOW exceeds MEAN_SWIPE_VELOCITY
const DRAG_VELOCITY_WINDOW = 300
const MEAN_SWIPE_VELOCITY = 0.8

export default (container, onSwipe, onDragStart, onDragStop) => {
  let dragTargets = []
  let startX, startY

  const clearDragTargets = () => {
    dragTargets.forEach(dragTarget => {
      dragTarget.style.transform = ''
    })
    dragTargets.length = 0
  }

  let lastMoveX = Infinity
  let lastMoveTime = -Infinity

  container.addEventListener('touchstart', event => {
    clearDragTargets()
    let {target} = event
    while (target.nodeName !== 'LI') {
      if (target.nodeName === 'UL' || target.nodeName === 'BODY')
        return
      target = target.parentNode
      if (! target)
        return
    }

    dragTargets = [target]
    const [touch] = event.touches
    startX = touch.clientX
    startY = touch.clientY
    lastMoveTime = Date.now()
  })


  let isDragging = false
  let dragBlocked = false
  const dragPoints = [] // used to calculate average velocity during drags

  // touch move calculation happens in two stages according to isDragging,
  // see the documentation on the constants in the header to see how it works
  container.addEventListener('touchmove', event => {
    if (! dragTargets.length || dragBlocked)
      return

    const [touch] = event.touches
    if (! isDragging) {
      const yDistance = Math.abs(touch.clientY - startY)
      if (yDistance >= MIN_DRAG_DISTANCE) {
        dragBlocked = true
        return
      }

      const xDistance = Math.abs(touch.clientX - startX)
      if (xDistance >= MIN_DRAG_DISTANCE) {
        if (onDragStart)
          onDragStart()
        lastMoveX = startX
        dragPoints.splice(0)
        isDragging = true
      }
      else {
        return
      }
    }

    // x delta since beginning of touch
    const xDelta = touch.clientX - startX
    if (xDelta < 0) {
      if (dragTargets.length === 1) {
        let {scrollTop} = document.documentElement
        if (! scrollTop)
          scrollTop = document.body.scrollTop

        let [dragTarget] = dragTargets
        for (;;) {
          const {previousSibling} = dragTarget
          if (! previousSibling)
            break
          dragTarget = previousSibling

          if (! dragTarget)
            break

          // give -1 for the negative margin
          if (dragTarget.offsetTop < scrollTop - 1)
            break

          dragTargets.push(dragTarget)
        }
      }
    }
    else if (dragTargets.length > 1) {
      dragTargets.splice(dragTargets.length - 1).forEach(dragTarget => {
        dragTarget.style.transform = ''
      })
    }

    const now = Date.now()
    const timeDelta = now - lastMoveTime
    // x delta since previous measurement
    dragPoints.push({timeDelta, xDelta: Math.abs(lastMoveX - touch.clientX) })

    // search for the last velocity that passes the measurement window while
    // calculating cumulative distance and times
    const {length: nDragPoints} = dragPoints
    let cumDistance = 0
    let cumTime = 0
    for (let i = nDragPoints - 1; i >= 0; --i) {
      cumTime += dragPoints[i].timeDelta

      if (cumTime >= DRAG_VELOCITY_WINDOW) {
        // subtract the time that fell outside the window
        cumTime -= dragPoints[i].timeDelta
        if (i > N_STORE_VELOCITIES)
          dragPoints.splice(0, i - 1)
        break
      }

      cumDistance += dragPoints[i].xDelta
    }

    const avgVelocity = cumDistance / cumTime
    // console.debug('avg', avgVelocity, timeDelta)
    if (avgVelocity > MEAN_SWIPE_VELOCITY) {
      dragBlocked = true
      isDragging = false
      if (onDragStop)
        onDragStop()

      onSwipe(elementIndexesFromNodes(container, dragTargets))

      // do not use clearDragTargets() as their translations should be kept
      // so that the flip move code can get the moved bounding rectangle
      dragTargets.splice(0)
      return
    }

    lastMoveX = touch.clientX
    lastMoveTime = now

    dragTargets.forEach(dragTarget => {
      dragTarget.style.transform = `translateX(${xDelta}px)`
    })
  })

  container.addEventListener('touchend', event => {
    dragBlocked = false
    if (isDragging) {
      if (onDragStop)
        onDragStop()
      clearDragTargets()
      isDragging = false
    }
  })
}

function elementIndexesFromNodes(container, nodes) {
  const listChildren = Array.from(container.children)
  return nodes.map(node => listChildren.indexOf(node))
}
