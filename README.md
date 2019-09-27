# WebRTC Direct Connection Testing

This website tests the WebRTC connectivity to provide intuitions about the
likelihood of connectivity between random participants on the Internet. It tries to establish a *direct* connection, which does not use a TURN relay server.

All participants get a real-time view of connections and a copy of the event log for offline analysis.

## Quick Start

Open https://webrtc-connection-testing.herokuapp.com/ in as many browsers as you want to test. In each, type a pseudonym to identify each instance, then click "Connect".

To connect from the commandline, similar to using [pando-computing](https://github.com/elavoie/pando-computing) with WebRTC do:
````
    git clone git@github.com:elavoie/webrtc-connection-testing
    cd webrtc-connection-testing
    npm install
    bin/participant 
````
If a line appears between two instances under "Current Connectivity", then a WebRTC connection was successful.

## Deploy your own server:
````
    git clone git@github.com:elavoie/webrtc-connection-testing
    cd webrtc-connection-testing
    npm install
    npm start
````

## Events

Here is a list of events logged by the server.

### participant-connected

A participant connected over a WebSocket to the server, which assigned it a random identifier and recorded their IP address.

```
  {
    type: 'participant-connected',
    id: String, // Identifier
    ip: String  // IP Address
  }
```

### participant-status-updated

A participant updated some personally identifiable information, such as a pseudoname, and their geographical location (if they agreed to reveal their location). This makes it easier to interpret the information in the log. Participants may update their status multiple times.

```
  {
    type: 'participant-status-update',
    id: String, // Identifier
    name: String, // Pseudo-name
    latitude: Number, 
    longitude: Number
  }
```

### participant-disconnected

A participant disconnected, intentionally or not, from the server (terminating their WebSocket connection).

```
  {
    type: 'participant-disconnected',
    id: String // Identifier
  }
```

### webrtc-connection-attempt

A participant tried to connect to another participant by opening a WebRTC channel.

```
  {
    type: 'webrtc-connection-attempt',
    origin: String, // Identifier
    destination: String, // Identifier
    initiator: Boolean, // True if participant at origin initiated the WebRTC connection, false otherwise.
    timestamp: Date // Timestamp as recorded by participant
  }
```


### webrtc-connection-signal

A signal emitted by a participant to inform another of how they may open a WebRTC connection.

```
  {
    type: 'webrtc-connection-signal',
    origin: String, // Identifier
    destination: String, // Identifier
    signal: Object, // WebRTC signal
    timestamp: Date // Timestamp as recorded by participant
  }
```

### webrtc-connection-opened

The connection between participants successfully opened.

```
  {
    type: 'webrtc-connection-opened',
    origin: String, // Identifier
    destination: String, // Identifier
    timestamp: Date // Timestamp as recorded by participant
  }
```

### webrtc-connection-confirmed

Data was successfully transmitted between participants through
the WebRTC connection.

```
  {
    type: 'webrtc-connection-confirmed',
    origin: String, // Identifier
    destination: String, // Identifier
    timestamp: Date // Timestamp as recorded by participant
  }
```

### webrtc-connection-closed

The connection between participants closed.

```
  {
    type: 'webrtc-connection-closed',
    origin: String, // Identifier
    destination: String, // Identifier
    timestamp: Date // Timestamp as recorded by participant
  }
```


### webrtc-connection-error

A connection to another participant failed, either before opening or after.

```
  {
    type: 'webrtc-connection-error',
    origin: String, // Identifier
    destination: String, // Identifier
    error: Error, 
    timestamp: Date // Timestamp as recorded by participant
  }
```
