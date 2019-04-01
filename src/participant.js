var Peer = require('simple-peer')
var Socket = require('simple-websocket')
var debug = require('debug')
var log = debug('webrtc-connection-testing')
var EE = require('events')

module.exports = function Participant (opts) {
  var opts = opts || {}
  opts.host = opts.host || '127.0.0.1'
  opts.protocol = opts.protocol || 'ws:'
  opts.name = opts.name || ''

  if (typeof opts.statusRequest === 'undefined') {
    opts.statusRequest = function () {}
  } else if (typeof opts.statusRequest !== 'function') {
    throw new Error('Invalid statusRequest argument, expecting function')
  }

  if (typeof navigator === 'undefined' && !opts.wrtc) {
    throw new Error('opts.wrtc required outside a browser')
  }

  var participant = new EE()
  var myId = null
  var eventLog = []
  var myConnections = {}
  var initIndex = 0
  var pendingSignals = {}
  var status = {
    id: null,
    name: '',
    latitude: 0,
    longitude: 0
  }

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
            },
            wrtc: opts.wrtc
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
            signals.forEach(function (s) { 
              log('passing signal: ' + JSON.stringify(s))
              p.signal(s) 
            })
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
        var id = msg.id
        myId = id
        console.log('id: ' + id)
        eventLog = msg.eventLog
        initIndex = eventLog.length
        var latestState = computeLatestState(eventLog)
        openWebRTCChannels(latestState.participants)
        participant.emit('init', id, msg.ip, latestState)
      } else if (msg.type === 'log-update') {
        for (var i = 0; i < msg.update.length; ++i) {
          eventLog.push(msg.update[i])
        }
        var latestState = computeLatestState(eventLog)
        openWebRTCChannels(latestState.participants)
        participant.emit('log-update', latestState)
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


    var socket = new Socket(opts.protocol + '//' + opts.host)
    var socketConnected = false
    socket.on('connect', function () {
      console.log('connected!')
      socketConnected = true
      participant.emit('connect')
    })
    
    socket.on('data', function (data) {
      dispatch(data)
    })

    socket.on('close', function () {
      console.log('socket closed')
      clearInterval(statusInterval)
      participant.emit('close')
    })

    socket.on('error', function (err) {
      console.log('socket error: ' + err)
      clearInterval(statusInterval)
      participant.emit('error', err)
    })

    function sendStatus () {
      if (socket && socketConnected) {
        var status = {
          type: 'status',
          id: myId,
          name: opts.name
        }
        opts.statusRequest(status)
        log('sending status: ' + JSON.stringify(status))
        socket.send(JSON.stringify(status))
      }
      participant.emit('status', eventLog)
    }
    statusInterval = setInterval(sendStatus, 5000)
  }

  participant.setStatus = function (_status) {
    _status = _status || {}
    status.name = _status.name || ''
    status.latitude = _status.latitude || 0
    status.longitude = _status.longitude || 0
  }

  connect()
  return participant
}
