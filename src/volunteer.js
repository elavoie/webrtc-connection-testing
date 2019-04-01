var Peer = require('simple-peer')
var Socket = require('simple-websocket')
var debug = require('debug')
var log = debug('volunteer')

var RADIUS = 150
var myId = null
var eventLog = []
var myConnections = {}
var initIndex = 0
var pendingSignals = {}

function computeLatestState (log) {
  var participants = {}
  var connections = {
    active: {},
    past: {}
  }

  for (var i = 0; i < log.length; ++i) {
    var ev = log[i]

    if (ev.type === 'participant-connected') {
      var id = ev.id
      participants[id] = {
        id: id,
        ip: ev.ip,
        logIndex: i
      }
    } else if (ev.type === 'participant-status-updated') {
      var id = ev.id
      participants[id].name = ev.name,
      participants[id].latitude = ev.latitude
      participants[id].longitude = ev.longitude
    } else if (ev.type === 'participant-disconnected') {
      delete participants[ev.id]
    } else if (ev.type === 'webrtc-connection-confirmed') {
      if (!connections.active[ev.origin]) {
        connections.active[ev.origin] = {}
      }
      connections.active[ev.origin][ev.destination] = ev
    } 
    // TODO: Handle terminated connections and disconnected participants
  }

  return {
    participants: participants,
    connections: connections
  }
}

function computeTargetPositions (nodes) {
  nodes.forEach(function (x,i) { 
    theta = (2*Math.PI*i)/nodes.length
    x.tx = RADIUS * Math.cos(theta)
    x.ty = RADIUS * Math.sin(theta)
    x.angle = theta
  }) 
}

function updateConnectivity (participants, connections) {
  var nodes = []
  var links = []

  var count = 0
  for (var id in participants) {
    var participant = participants[id]
    participant.tx = 0
    participant.ty = 0
    participant.angle = 0
    nodes.push(participant)
  }

  nodes.sort(function (a,b) { return b.id - a.id })
  computeTargetPositions(nodes)

  d3.select('#connectivity')
  .attr("viewBox", [-600 / 2, -300 / 2, 600, 300])
  .selectAll('text')
  .data(nodes, function (d) { return d.id })
  .join('text')
  .text(function (d) { return d.name ? d.name : '(' + d.id + ')' })
  .transition().duration(750)
    .attr('transform', function (d) { 
      return 'translate(170) ' +
            'rotate('+ Math.round((d.angle*360)/(2*Math.PI)) +',-170,0) ' + 
            ((d.angle >= Math.PI/2 && d.angle < Math.PI*(3/2)) ? 'rotate(180) ' : '')
    })
    .attr('style', function (d) {
      return ((d.angle >= Math.PI/2 && d.angle < Math.PI*(3/2)) ? 'text-anchor:end' : 'text-anchor:beginning')
    })

  var active = []
  if (connections.active) {
    for (var origin in connections.active) {
      for (var destination in connections.active[origin]) {
        if (participants[origin] && participants[destination]) {
          active.push({
            source: participants[origin],
            target: participants[destination]
          })
        }
      }
    }
  }

  d3.select('#connectivity').selectAll("line")
  .data(active)
  .join("line")
  .attr("stroke-width", 2)
  .attr("stroke", "#999")
  .attr("stroke-opacity", 0.8)
  .transition().duration(750)
  .attr("x1", d => d.source.tx)
  .attr("y1", d => d.source.ty)
  .attr("x2", d => d.target.tx)
  .attr("y2", d => d.target.ty)

}

var displayedOnMap = {}
function updateMap (participants) {
  var active = {}

  for (var id in participants) {
    active[id] = true
    var participant = participants[id]

    if (displayedOnMap[id]) {
      displayedOnMap[id].unbindPopup()
      displayedOnMap[id].bindPopup('Participant ' + id + ': ' + participant.name)

      if (participant.latitude && participant.longitude) {
        displayedOnMap[id].setLatLng([
          participant.latitude, 
          participant.longitude
        ])
      }
      continue
    }

    if (participant.latitude && participant.longitude) {
      var circle = L.circle([
        participant.latitude, 
        participant.longitude
      ], {
        color: participant.id === myId ? 'red' : 'blue',
        fillColor: '#f03',
        fillOpacity: 0.5,
        radius: 500
      }).addTo(MAP)
      displayedOnMap[id] = circle
      displayedOnMap[id].bindPopup('Participant ' + id + ' ' + participant.name)
    }
  }

  for (var id in displayedOnMap) {
    if (!active[id]) {
      displayedOnMap[id].remove()
      delete displayedOnMap[id]
    }
  }
}

function updateTable (participants, activeConnections) {
  var ids = Object.keys(participants)
  ids.sort()
  var participantsBox = document.getElementById('participants')
  var text = '<table>'
  text += '<tr class="participant">' 
  text += '<th class="participantName">NAME</th>' 
  text += '<th class="participantCoord">LATITUDE</th>' 
  text += '<th class="participantCoord">LONGITUDE</th>' 
  text += '<th class="participantStatus">WEBRTC-STATUS</th>' 
  text += '<th class="participantId">ID</th>'
  for (var i = 0; i < ids.length; ++i) {
    var id = ids[i]
    if (id !== myId) {
      var participant = participants[id]
      text += '<tr class="participant">' 
      text += '<th class="participantName">' + participant.name + '</th>' 
      text += '<th class="participantCoord">' + participant.latitude + '</th>' 
      text += '<th class="participantCoord">' + participant.longitude + '</th>' 
      text += '<th class="participantStatus" id="status-' + id + '">' + (activeConnections[myId] && activeConnections[myId][id] ? 'Connected' : 'Available') + '</th>' 
      text += '<th class="participantId">' + id + '</th>'
      text += '</tr>'
    }
  } 
  text += '</table>'
  participantsBox.innerHTML = text
}


function connect () {

  function openWebRTCChannels (participants) {
    if (!socket) {
      log('ERROR Opening WebRTC channel, invalid socket: ' + socket)
    }

    for (var id in participants) {
      if (id === myId) continue

      (function () { // Creating lexical scope to avoid variable capture bugs
        var participant = participants[id]
        var remoteId = id

        if (myConnections[remoteId]) return 

        var initiator = participant.logIndex < initIndex
        var p = new Peer({ 
          initiator: initiator,
          config: {
            iceServers: [{ 
              url: 'stun:stun.l.google.com:19302' 
            }]
          }
        })
        myConnections[remoteId] = p
        socket.send(JSON.stringify({
          type: 'webrtc-connection-attempt',
          origin: myId,
          destination: remoteId,
          initiator: initiator,
          timestamp: new Date()
        }))

        p.on('error', function (err) { 
          log('ERROR from ' + remoteId) 
          log(err)
          socket.send(JSON.stringify({
            type: 'webrtc-connection-error',
            origin: myId,
            destination: remoteId,
            error: err,
            timestamp: new Date()
          }))
          delete myConnections[remoteId]
        })

        p.on('signal', function (data) {
          log('SIGNAL from ' + myId + ' to ' + remoteId + ' : ' + data)
          socket.send(JSON.stringify({
            type: 'webrtc-connection-signal',
            origin: myId,
            destination: remoteId,
            signal: data,
            timestamp: new Date()
          }))
        })

        p.on('close', function () {
          log('CLOSING connection to ' + remoteId)
          socket.send(JSON.stringify({
            type: 'webrtc-connection-closed',
            origin: myId,
            destination: remoteId,
            timestamp: new Date()
          }))
          delete myConnections[remoteId]
        })

        p.on('connect', function () {
          console.log('CONNECTED to ' + remoteId)
          socket.send(JSON.stringify({
            type: 'webrtc-connection-opened',
            origin: myId,
            destination: remoteId,
            timestamp: new Date()
          }))
          p.send('hello')
        })

        p.on('data', function (data) {
          if (data.toString() === 'hello') {
            socket.send(JSON.stringify({
              type: 'webrtc-connection-confirmed',
              origin: myId,
              destination: remoteId,
              timestamp: new Date()
            }))
          } else {
            log('DATA ERROR from ' + remoteId) 
            log(data)
            socket.send(JSON.stringify({
              type: 'webrtc-connection-error',
              origin: myId,
              destination: remoteId,
              error: data.toString(),
              timestamp: new Date()
            }))
          }
        })
        
        if (pendingSignals[remoteId]) {
          log('processing pending signals from ' + remoteId)
          var signals = pendingSignals[remoteId]
          delete pendingSignals[remoteId]
          signals.forEach(function (s) { p.signal(s) })
        }
      })()
    }
  }

  function dispatch(data) {
    try {
      var msg = JSON.parse(data)
    } catch (err) {
      console.error('Expected json message, got ' + data)
      console.error(err)
      return
    }
    if (msg.type === 'init') {
      document.getElementById('ipAddress').textContent = msg.ip
      var id = msg.id
      myId = id
      eventLog = msg.eventLog
      initIndex = eventLog.length
      document.getElementById('infoTitle').textContent = 'Your Information (id: ' + id + ')'
      var latestState = computeLatestState(eventLog)
      openWebRTCChannels(latestState.participants)
    } else if (msg.type === 'log-update') {
      for (var i = 0; i < msg.update.length; ++i) {
        eventLog.push(msg.update[i])
      }
      var latestState = computeLatestState(eventLog)
      openWebRTCChannels(latestState.participants)
      updateConnectivity(latestState.participants, latestState.connections)
      updateMap(latestState.participants)
      // updateTable(latestState.participants, latestState.connections.active)
    } else if (msg.type === 'webrtc-connection-signal') {
      if (!myConnections[msg.origin]) {
        if (!pendingSignals[msg.origin]) {
          pendingSignals[msg.origin] = []
        } 

        log('SIGNAL deferred from ' + msg.origin)
        pendingSignals[msg.origin].push(msg.signal)
      } else {
        log('SIGNAL received from ' + msg.origin)
        myConnections[msg.origin].signal(msg.signal)
      }
    } else {
      log('dispatch WARNING unsupported message: ' + data)
    }
  }

  var statusInterval = null

  if (socket) {
    clearInterval(statusInterval)
    socket.terminate()
    socket = null
  }

  var protocol = location.protocol === 'http:' ? 'ws:' : 'wss:'
  var host = location.host
  var socket = new Socket(protocol + '//' + host)
  socket.on('connect', function () {
    console.log('connected!')
    document.getElementById('connect-btn').textContent = 'Connected'
    document.getElementById('connect-btn').className = 'button buttonHold'
  })
  
  socket.on('data', function (data) {
    dispatch(data)
  })

  socket.on('close', function () {
    console.log('socket closed')
    document.getElementById('connect-btn').textContent = 'Connect'
    document.getElementById('connect-btn').className = 'button'
    updateMap({})
    updateConnectivity({}, {})
    clearInterval(statusInterval)
  })

  socket.on('error', function (err) {
    console.log('socket error: ' + err)
    document.getElementById('connect-btn').textContent = 'Connect'
    document.getElementById('connect-btn').className = 'button'
    updateMap({})
    updateConnectivity({}, {})
    clearInterval(statusInterval)
  })

  if (typeof navigator !== 'undefined') {
    navigator.geolocation.getCurrentPosition(function(location) {
      console.log('location:')
      var latitude = location.coords.latitude
      var longitude = location.coords.longitude
      var accuracy = location.coords.accuracy
      console.log(latitude)
      console.log(longitude)
      console.log(accuracy)
      document.getElementById('latInput').value = latitude
      document.getElementById('longInput').value = longitude
    });
  }

  function sendStatus () {
    if (socket) {
      var status = {
        type: 'status',
        id: myId,
        name: document.getElementById('nameInput').value,
        latitude: document.getElementById('latInput').value,
        longitude: document.getElementById('longInput').value
      }
      log('sending status: ' + JSON.stringify(status))
      socket.send(JSON.stringify(status))
    }
    document.getElementById('events-log').textContent = JSON.stringify(eventLog, null, 2)
  }
  statusInterval = setInterval(sendStatus, 5000)
}


module.exports = {
  connect: connect
}
