var Peer = require('simple-peer')
var Socket = require('simple-websocket')
var debug = require('debug')
var log = debug('volunteer')
var Participant = require('./participant.js')

var myId = null
var RADIUS = 150

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

module.exports = {
  connect: function () {
    var participant = new Participant({
      protocol:  location.protocol === 'http:' ? 'ws:' : 'wss:',
      host: location.host,
      statusRequest: function (_status) {
        _status.name = document.getElementById('nameInput').value,
        _status.latitude = document.getElementById('latInput').value,
        _status.longitude = document.getElementById('longInput').value
      }
    })
    participant.on('connect', function () {
      document.getElementById('connect-btn').textContent = 'Connected'
      document.getElementById('connect-btn').className = 'button buttonHold'
    })
    .on('init', function (id, ip, latestState) {
      myId = id
      document.getElementById('infoTitle').textContent = 'Your Information (id: ' + id + ')'
      document.getElementById('ipAddress').textContent = ip
    })
    .on('log-update', function (latestState) {
      updateConnectivity(latestState.participants, latestState.connections)
      updateMap(latestState.participants)
      // updateTable(latestState.participants, latestState.connections.active)
    })
    .on('close', function () {
      document.getElementById('connect-btn').textContent = 'Connect'
      document.getElementById('connect-btn').className = 'button'
      updateMap({})
      updateConnectivity({}, {})
    })
    .on('error', function (err) {
      document.getElementById('connect-btn').textContent = 'Connect'
      document.getElementById('connect-btn').className = 'button'
      updateMap({})
      updateConnectivity({}, {})
    })
    .on('status', function (eventLog) {
      document.getElementById('events-log').textContent = JSON.stringify(eventLog, null, 2)
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

    return participant
  }
}
