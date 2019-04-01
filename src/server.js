var WebSocket = require('ws')
var http = require('http')
var os = require('os')
var debug = require('debug')
var log = debug('webrtc-testing')
var express = require('express')
var app = express()
var PORT = process.env.PORT || 8080

var eventLog = []
var frontier = {} // Map participant ID to event log latest update sent

var seed = Math.round(Math.random() * Math.pow(2,31))
function randomInt () {
  // Robert Jenkins' 32 bit integer hash function.
  seed = ((seed + 0x7ed55d16) + (seed << 12)) & 0xffffffff
  seed = ((seed ^ 0xc761c23c) ^ (seed >>> 19)) & 0xffffffff
  seed = ((seed + 0x165667b1) + (seed << 5)) & 0xffffffff
  seed = ((seed + 0xd3a2646c) ^ (seed << 9)) & 0xffffffff
  seed = ((seed + 0xfd7046c5) + (seed << 3)) & 0xffffffff
  seed = ((seed ^ 0xb55a4f09) ^ (seed >>> 16)) & 0xffffffff
  return seed
}

function getIPAddresses () {
  var ifaces = os.networkInterfaces()
  var addresses = []

  Object.keys(ifaces).forEach(function (ifname) {
    var alias = 0

    ifaces[ifname].forEach(function (iface) {
      if (iface.family !== 'IPv4' || iface.internal !== false) {
        // skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
        return
      }

      if (alias >= 1) {
        // this single interface has multiple ipv4 addresses
        addresses.push(iface.address)
      } else {
        // this interface has only one ipv4 adress
        addresses.push(iface.address)
      }
    })
  })
  return addresses
}

function getParticipants () {
  var participants = {}
  for (var id in participant) {
    participants[id] = {
      id: id,
      name: participant[id].name,
      latitude: participant[id].latitude,
      longitude: participant[id].longitude,
      lastActivity: participant[id].lastActivity
    }
  }
  return participants
}

function dispatch (data) {
  try {
    var msg = JSON.parse(data)
    if (msg.type === 'status') {
      var id = msg.id
      participant[id].lastActivity = new Date() // Avoids ping-pong
      
      if (participant[id].name !== msg.name ||
        participant[id].latitude !== msg.latitude ||
        participant[id].longitude !== msg.longitude) {

        participant[id].name = msg.name
        participant[id].latitude = msg.latitude
        participant[id].longitude = msg.longitude
        log('updated participant[' + id + '] with ' + JSON.stringify(msg))
        eventLog.push({
          type: 'participant-status-updated',
          id: msg.id,
          name: msg.name,
          latitude: msg.latitude,
          longitude: msg.longitude
        })
      }
    } else if (msg.type === 'webrtc-connection-signal') {
      eventLog.push(msg)
      log('forwarding signal to ' + msg.destination + ' ' + data)
      participant[msg.destination].ws.send(JSON.stringify(msg))  
    } else if (msg.type.indexOf('webrtc') > -1) {
      eventLog.push(msg)
    } else {
      log('dispatch warning: unsupported message ' + data)
    }
  } catch (err) {
    log('dispatch error on message ' + data)
    log(err)
  }

}

var participant = { }

app.use(express.static('public'))

var httpServer = app.listen(PORT, function () {
  getIPAddresses().forEach(function (addr) {
    console.error('server accessible at ' + addr + ':' + PORT)
  })
})

var wss = new WebSocket.Server({ server: httpServer })

wss.on('connection' , function (ws, req) {
  var id = (randomInt() >>> 1).toString(16)
  ws.id = id

  participant[id] = {
    id: id,
    name: '',
    ws: ws,
    ip: req.connection.remoteAddress,
    latitude: 0,
    longitude: 0,
    lastActivity: new Date()
  }

  var ip = req.connection.remoteAddress
  eventLog.push({
    type: 'participant-connected',
    id: id,
    ip: ip
  })
  frontier[id] = eventLog.length

  log('new participant[' + id + '] connected from ' + ip)
  ws.on('pong', function () {
    participant[id].lastActivity = new Date()
    log('participant[' + id + ']: pong')
  })
  ws.send(JSON.stringify({
    type: 'init',
    id: id,
    ip: participant[id].ip,
    eventLog: eventLog.slice()
  }))
  ws.on('message', dispatch)
})

// Heartbeat
var INTERVAL = 5000
var heartbeat = setInterval(function ping() {
  log('heartbeat')
  var minusInterval = new Date(new Date() - INTERVAL) // Xs ago
  var deadline = new Date(new Date() - 2*INTERVAL)
  for (var id in participant) {
    if (participant[id].lastActivity < deadline) {
      log('terminating participant[' + id + ']')
      participant[id].ws.terminate()
      delete participant[id]
      eventLog.push({
        type: 'participant-disconnected',
        id: id
      })
    } else if (participant[id].lastActivity < minusInterval) {
      log('pinging participant[' + id + ']')
      participant[id].ws.ping(function () {})
    }
  }
  for (var id in participant) {
    if (frontier[id] < eventLog.length) {
      var newFrontier = eventLog.length
      participant[id].ws.send(JSON.stringify({
        type: 'log-update',
        update: eventLog.slice(frontier[id])
      }), function (err) {
        if (err) {
          log('participant[' + id + '] sending error: ' + err)
          participant[id].ws.terminate()
          delete participant[id]
          eventLog.push({
            type: 'participant-disconnected',
            id: id
          })
        }
      })
      frontier[id] = newFrontier
    }
  }
}, INTERVAL)

