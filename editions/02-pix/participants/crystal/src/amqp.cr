require "amqp-client"


module AMQPClient
  puts ENV.fetch("BROKER_URL")
  CONNECTION = AMQP::Client.new(
    URI.parse(ENV.fetch("BROKER_URL"))
  ).connect
  CHANNEL = CONNECTION.channel
  QUEUE_NAME = "v1:transfers"
  CHANNEL.queue_declare(QUEUE_NAME, durable: true)
  CHANNEL.queue_bind(QUEUE_NAME, "amq.direct", QUEUE_NAME)
  X = CHANNEL.direct_exchange
  def self.publish(message : IO)
    X.publish(message.getb_to_end, QUEUE_NAME)
  end
end
