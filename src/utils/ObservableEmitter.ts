import { debug, Debugger } from 'debug'
import type { EventMapType } from 'strict-event-emitter'
import { getStackTrace } from './getStackTrace'

export interface QueueItem<Args extends unknown[]> {
  args: Args
  done: Promise<unknown>
}

export type EventRecord<Listener extends (...args: unknown[]) => unknown> = {
  listeners: Set<Listener>
  queue: QueueItem<Parameters<Listener>>[]
}

export class ObservableEmitter<EventMap extends EventMapType = {}> {
  private log: Debugger
  private callFrame: string

  protected events: Map<keyof EventMap, EventRecord<EventMap[any]>> = new Map()

  constructor(domain?: string) {
    this.log = debug('emitter')

    if (domain) {
      this.log = this.log.extend(domain)
    }

    this.callFrame = getStackTrace()

    this.log('created a new emitter')
  }

  public addListener<Event extends keyof EventMap>(
    event: Event,
    listener: EventMap[Event]
  ): void {
    const eventRecord = this.getEvent(event)
    eventRecord.listeners.add(listener)

    this.log(
      'added "%s" listener (%d total)!',
      event,
      this.listenerCount(event),
      this.listeners(event)
    )
  }

  public removeListener<Event extends keyof EventMap>(
    event: Event,
    listener: EventMap[Event]
  ): void {
    if (!this.events.has(event)) {
      return
    }

    this.getEvent(event)!.listeners.delete(listener)
  }

  public removeAllListeners<Event extends keyof EventMap>(event?: Event): void {
    if (typeof event === 'undefined') {
      this.events.clear()
      this.log('removed all listeners!', this.events)
      return
    }

    this.getEvent(event).listeners.clear()
    this.log('removed all listeners for "%s"!', event, this.events.get(event))
  }

  public on<Event extends keyof EventMap>(
    event: Event,
    listener: EventMap[Event]
  ): void {
    this.addListener(event, listener)
  }

  public once<Event extends keyof EventMap>(
    event: Event,
    listener: EventMap[Event]
  ): void {
    const onceListener = ((...args: Parameters<EventMap[Event]>) => {
      this.removeListener(event, onceListener)
      listener(...args)
    }) as EventMap[Event]

    this.addListener(event, onceListener)
  }

  public off<Event extends keyof EventMap>(
    event: Event,
    listener: EventMap[Event]
  ): void {
    this.removeListener(event, listener)
  }

  public emit<Event extends keyof EventMap>(
    event: Event,
    ...args: Parameters<EventMap[Event]>
  ): void {
    const { listeners, queue } = this.getEvent(event)

    this.log(
      'emitting "%s" event for %d listeners:',
      event,
      this.listenerCount(event),
      args,
      this.listeners(event),
      this.callFrame
    )

    for (const listener of listeners) {
      queue.push({
        args,
        done: this.wrapListener(listener, ...args),
      })
    }
  }

  public listeners<Event extends keyof EventMap>(event: Event): Set<Function> {
    return this.events.get(event)?.listeners || new Set()
  }

  public listenerCount<Event extends keyof EventMap>(event: Event): number {
    return this.events.get(event)?.listeners.size || 0
  }

  public untilIdle<Event extends keyof EventMap>(
    event: Event,
    predicate: (item: QueueItem<Parameters<EventMap[Event]>>) => boolean = () =>
      true
  ): Promise<void> {
    const { queue } = this.getEvent(event)

    this.log('awaiting "%s" listeners queue...', event, queue)

    return Promise.all(queue.filter(predicate).map(({ done }) => done))
      .then(() => {
        this.log('all "%s" listeners have resolved!', event, queue)
      })
      .finally(() => {
        this.clearQueue(event)
        this.log(
          'cleared the "%s" queue!',
          event,
          this.events.get(event)?.queue
        )
      })
  }

  private getEvent<Event extends keyof EventMap>(
    event: Event
  ): EventRecord<EventMap[any]> {
    const eventRecord = this.events.get(event)

    if (typeof eventRecord !== 'undefined') {
      return eventRecord
    }

    this.events.set(event, {
      listeners: new Set(),
      queue: [],
    })

    return this.events.get(event)!
  }

  private wrapListener(listener: EventMap[any], ...args: unknown[]) {
    return new Promise<void>(async (resolve, reject) => {
      try {
        await listener(...args)
        resolve()
      } catch (error) {
        reject(error)
      }
    })
  }

  private clearQueue<Event extends keyof EventMap>(event: Event): void {
    const events = this.events.get(event)

    if (events) {
      events.queue = []
    }
  }
}
