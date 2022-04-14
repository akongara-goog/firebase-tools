import * as _ from "lodash";
import * as express from "express";
import * as cors from "cors";
import { logger } from "../logger";
import { Constants } from "./constants";
import { EmulatorInfo, EmulatorInstance, Emulators } from "./types";
import { createDestroyer } from "../utils";
import { EmulatorLogger } from "./emulatorLogger";
import { EventTrigger } from "./functionsEmulatorShared";
import { CloudEvent } from "./events/types";

interface RequestWithRawBody extends express.Request {
  rawBody: Buffer;
}

interface CustomEventTrigger {
  projectId: string;
  triggerName: string;
  eventTrigger: EventTrigger;
}

export interface EventarcEmulatorArgs {
  port?: number;
  host?: string;
}

export class EventarcEmulator implements EmulatorInstance {
  private destroyServer?: () => Promise<void>;

  private logger = EmulatorLogger.forEmulator(Emulators.EVENTARC);
  private customEvents: { [key: string]: CustomEventTrigger } = {};

  constructor(private args: EventarcEmulatorArgs) {}

  createHubServer(): express.Application {
    const hub = express();

    hub.use(express.json())

    const helloWorldRoute = `/hello_world`;
    const registerTriggerRoute = `/emulator/v1/projects/:project_id/triggers/:trigger_name`;

    const registerTriggerHandler: express.RequestHandler = (req, res) => {
      const projectId = req.params.project_id;
      const triggerName = req.params.trigger_name;
      logger.info(`Registering custom event trigger for ${triggerName}.`);
      const reqBody = (req as RequestWithRawBody).rawBody;
      const proto = JSON.parse(reqBody.toString());
      const eventTrigger = proto.eventTrigger as EventTrigger;
      if (!eventTrigger) {
        logger.debug(`Missing event trigger for ${triggerName}.`);
        res.status(400);
        return;
      }
      const key = `${eventTrigger.eventType}-${eventTrigger.channel}`;
      this.customEvents[key] = { projectId, triggerName, eventTrigger };
    };

    /*
    // A trigger named "foo" needs to respond at "foo" as well as "foo/*" but not "fooBar".
    const httpsFunctionRoutes = [httpsFunctionRoute, `${httpsFunctionRoute}/*`];
    */
    const publishEventsRoute = `/v1/projects/:project_id/locations/:location/channels/:channel::publishEvents`;

    const helloWorldHandler: express.RequestHandler = (req, res) => {
      res.sendStatus(200);
    };

    const publishEventsHandler: express.RequestHandler = (req, res) => {
      const channel = req.params.channel;
      const events = req.body.events;
      for (const event of events) {
        // @todo: Call background handler. 
        if (!event.type) {
          res.sendStatus(400);
        }
      }
      res.sendStatus(200);
    }

    hub.all([helloWorldRoute], helloWorldHandler);
    hub.post([registerTriggerRoute], registerTriggerHandler);
    hub.post([publishEventsRoute], publishEventsHandler);
    hub.all("*", (req, res) => {
      logger.debug(`Eventarc emulator received unknown request at path ${req.path}`);
      res.sendStatus(404);
    });
    return hub;
  }

  async start(): Promise<void> {
    const { host, port } = this.getInfo();
    const server = this.createHubServer().listen(port, host);
    this.destroyServer = createDestroyer(server);
    return Promise.resolve();
  }

  async connect(): Promise<void> {
    // wip. what to do here?
  }

  async stop(): Promise<void> {
    if (this.destroyServer) {
      await this.destroyServer();
    }
  }

  getInfo(): EmulatorInfo {
    const host = this.args.host || Constants.getDefaultHost(Emulators.EVENTARC);
    const port = this.args.port || Constants.getDefaultPort(Emulators.EVENTARC);

    return {
      name: this.getName(),
      host,
      port,
    };
  }

  getName(): Emulators {
    return Emulators.EVENTARC;
  }
}