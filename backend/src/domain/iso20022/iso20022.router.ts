import { Router, Request, Response } from 'express';
import express from 'express';
import { authenticateToken } from '../../middleware/auth.middleware';
import {
  ISO20022_SCHEMA_DIR,
  Iso20022MessageType,
  describeSchemas,
  getMessageSchema,
} from './messageSchemas';
import { validationAvailability, validateIso20022Document } from './xsdValidator.service';
import { ParsedIso20022Document, parseIso20022Document } from './parser.service';
import {
  getIso20022Message,
  listIso20022Messages,
  listIso20022Transactions,
  persistIso20022Message,
  resolveMessageCurrency,
} from './iso20022.service';
import { buildPain001Xml } from './pain001.builder';
import { buildPain002Xml } from './pain002.builder';
import { buildPain007Xml } from './pain007.builder';
import { buildPain008Xml } from './pain008.builder';

/**
 * ISO 20022 payments-initiation API.
 *
 *   GET  /api/iso20022/health                  validator + schema availability (public)
 *   GET  /api/iso20022/schemas                 registered message types
 *   POST /api/iso20022/validate                XSD-validate an uploaded document
 *   POST /api/iso20022/generate/:messageType   build an outbound message (+validate, +store)
 *   POST /api/iso20022/ingest                  parse, validate and store an inbound message
 *   GET  /api/iso20022/messages                stored message index
 *   GET  /api/iso20022/messages/:id            stored message (header facts + payload)
 *   GET  /api/iso20022/messages/:id/xml        stored payload as application/xml
 *   GET  /api/iso20022/transactions            reconciliation lookup by EndToEndId / UETR
 */

const router = Router();

/** Accepts a raw ISO 20022 body in addition to the global JSON parser. */
const xmlBody = express.text({
  type: ['application/xml', 'text/xml', 'application/iso20022+xml'],
  limit: '10mb',
});

const MESSAGE_TYPE_ALIASES: Record<string, Iso20022MessageType> = {
  pain001: 'pain.001.001.13',
  pain00100113: 'pain.001.001.13',
  pain002: 'pain.002.001.15',
  pain00200115: 'pain.002.001.15',
  pain007: 'pain.007.001.13',
  pain00700113: 'pain.007.001.13',
  pain008: 'pain.008.001.12',
  pain00800112: 'pain.008.001.12',
};

function resolveMessageType(value: string): Iso20022MessageType {
  const key = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const resolved = MESSAGE_TYPE_ALIASES[key];
  if (!resolved) {
    throw new Error(
      `Unsupported message type "${value}". Accepted: pain001, pain002, pain007, pain008 (or the full pain.xxx.xxx.xx identifier)`
    );
  }
  return resolved;
}

function extractXml(req: Request): string {
  const body: any = req.body;
  if (typeof body === 'string' && body.trim()) return body;
  if (body && typeof body === 'object') {
    const candidate = body.xml ?? body.document ?? body.message;
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  throw new Error('The ISO 20022 document is required (JSON field "xml" or an application/xml body)');
}

function wantsDownload(req: Request): boolean {
  const value = String((req.query as any)?.download ?? '').toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function buildMessage(messageType: Iso20022MessageType, input: any) {
  switch (messageType) {
    case 'pain.001.001.13':
      return buildPain001Xml(input);
    case 'pain.002.001.15':
      return buildPain002Xml(input);
    case 'pain.007.001.13':
      return buildPain007Xml(input);
    case 'pain.008.001.12':
      return buildPain008Xml(input);
    default: {
      const exhaustive: never = messageType;
      throw new Error(`No builder registered for ${exhaustive}`);
    }
  }
}

/** Resolves the message type for an uploaded document: declared, else detected. */
function resolveUploadedMessageType(req: Request, xml: string): Iso20022MessageType {
  const declared = (req.query as any)?.messageType;
  if (declared) return resolveMessageType(String(declared));
  return parseIso20022Document(xml).messageType;
}

router.get('/health', async (_req: Request, res: Response) => {
  const availability = await validationAvailability();
  res.json({
    service: 'iso20022',
    schemaDirectory: ISO20022_SCHEMA_DIR,
    messageTypes: describeSchemas().map(schema => ({
      messageType: schema.messageType,
      messageName: schema.messageName,
      direction: schema.direction,
      xsdPresent: schema.xsdPresent,
    })),
    validation: availability,
  });
});

router.get('/schemas', authenticateToken, (_req: Request, res: Response) => {
  res.json({ schemas: describeSchemas() });
});

router.post('/validate', authenticateToken, xmlBody, async (req: Request, res: Response) => {
  try {
    const xml = extractXml(req);
    const messageType = resolveUploadedMessageType(req, xml);
    const validation = await validateIso20022Document(xml, messageType);
    const schema = getMessageSchema(messageType);
    res.status(validation.valid ? 200 : validation.available ? 422 : 503).json({
      messageType,
      messageName: schema.messageName,
      validation,
    });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'Unable to validate the ISO 20022 document' });
  }
});

router.post('/generate/:messageType', authenticateToken, async (req: Request, res: Response) => {
  try {
    const messageType = resolveMessageType(String(req.params.messageType));
    const built = buildMessage(messageType, req.body ?? {});

    const validation = String((req.query as any)?.validate ?? 'true').toLowerCase() === 'false'
      ? null
      : await validateIso20022Document(built.xml, messageType);

    // A generated document that fails its own schema is a defect — surface it.
    if (validation?.available && !validation.valid) {
      return res.status(422).json({
        error: 'The generated document failed XSD validation',
        messageType,
        messageId: built.messageId,
        validation,
        xml: built.xml,
      });
    }

    const stored = await persistIso20022Message({
      xml: built.xml,
      direction: 'OUTBOUND',
      source: 'GENERATED',
      parsed: parseIso20022Document(built.xml),
      validation,
    });

    if (wantsDownload(req)) {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${messageType}-${built.messageId}.xml"`);
      return res.send(built.xml);
    }

    res.status(201).json({
      messageType: built.messageType,
      messageName: built.messageName,
      messageId: built.messageId,
      creationDateTime: built.creationDateTime,
      numberOfTransactions: built.numberOfTransactions,
      controlSum: built.controlSum,
      currency: built.currency,
      initiatingParty: built.initiatingParty,
      validation,
      stored,
      xml: built.xml,
    });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'Unable to generate the ISO 20022 message' });
  }
});

router.post('/ingest', authenticateToken, xmlBody, async (req: Request, res: Response) => {
  try {
    const xml = extractXml(req);
    const parsed: ParsedIso20022Document = parseIso20022Document(xml);
    const validation = await validateIso20022Document(xml, parsed.messageType);

    if (validation.available && !validation.valid) {
      return res.status(422).json({
        error: 'The uploaded document failed XSD validation',
        messageType: parsed.messageType,
        validation,
      });
    }

    const stored = await persistIso20022Message({
      xml,
      direction: 'INBOUND',
      source: 'INGESTED',
      parsed,
      validation,
    });

    res.status(201).json({
      messageType: parsed.messageType,
      messageName: parsed.messageName,
      messageId: parsed.messageId,
      creationDateTime: parsed.creationDateTime,
      originalMessageId: parsed.originalMessageId,
      originalMessageNameId: parsed.originalMessageNameId,
      groupStatus: parsed.groupStatus,
      numberOfTransactions: parsed.numberOfTransactions,
      controlSum: parsed.controlSum,
      currency: resolveMessageCurrency(parsed),
      warnings: parsed.warnings,
      paymentInstructions: parsed.paymentInstructions,
      validation,
      stored,
    });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'Unable to ingest the ISO 20022 document' });
  }
});

router.get('/messages', authenticateToken, async (req: Request, res: Response) => {
  try {
    const query = req.query as any;
    const result = await listIso20022Messages({
      messageType: query.messageType ? resolveMessageType(String(query.messageType)) : undefined,
      direction: query.direction ? String(query.direction).toUpperCase() : undefined,
      originalMessageId: query.originalMessageId ? String(query.originalMessageId) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    });
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'Unable to list ISO 20022 messages' });
  }
});

router.get('/messages/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const message = await getIso20022Message(String(req.params.id));
    if (!message) return res.status(404).json({ error: 'ISO 20022 message not found' });
    if (String((req.query as any)?.payload ?? 'true') === 'false') {
      const { payload, ...rest } = message;
      return res.json(rest);
    }
    res.json(message);
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'Unable to load the ISO 20022 message' });
  }
});

router.get('/messages/:id/xml', authenticateToken, async (req: Request, res: Response) => {
  try {
    const message = await getIso20022Message(String(req.params.id));
    if (!message) return res.status(404).json({ error: 'ISO 20022 message not found' });
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${message.messageType}-${message.messageId}.xml"`);
    res.send(message.payload);
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'Unable to load the ISO 20022 message' });
  }
});

router.get('/transactions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const query = req.query as any;
    const transactions = await listIso20022Transactions({
      endToEndId: query.endToEndId ? String(query.endToEndId) : undefined,
      uetr: query.uetr ? String(query.uetr).toLowerCase() : undefined,
      messageId: query.messageId ? String(query.messageId) : undefined,
      messageType: query.messageType ? resolveMessageType(String(query.messageType)) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    });
    res.json({ transactions });
  } catch (error: any) {
    res.status(400).json({ error: error?.message || 'Unable to query ISO 20022 transactions' });
  }
});

export default router;
