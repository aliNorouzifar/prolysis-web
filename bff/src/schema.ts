// GraphQL schema (Pothos, code-first). Reads go to Postgres via Kysely; mutations and
// compute go to the Python backend over REST. JSON-ish payloads (params, metrics, rules,
// Plotly figures) cross this API as JSON **strings** — the SPA parses them.
import SchemaBuilder from "@pothos/core";
import { backend, type BackendHealth } from "./backend";
import { db, dbHealthy } from "./db";

const builder = new SchemaBuilder<{}>({});

const S = (v: unknown): string => JSON.stringify(v ?? null);
// Normalize a DB timestamp (Date at runtime via pg; typed opaquely by Kysely) to a Date.
const D = (v: unknown): Date => new Date(v as string | number | Date);

// --- Health -----------------------------------------------------------------------

const BackendHealthRef = builder.objectRef<BackendHealth>("BackendHealth");
BackendHealthRef.implement({
  fields: (t) => ({
    status: t.exposeString("status"),
    service: t.exposeString("service"),
  }),
});

interface HealthShape {
  bff: string;
  backend: BackendHealth;
  dbOk: boolean;
}
const HealthRef = builder.objectRef<HealthShape>("Health");
HealthRef.implement({
  fields: (t) => ({
    bff: t.exposeString("bff"),
    dbOk: t.exposeBoolean("dbOk"),
    backend: t.field({ type: BackendHealthRef, resolve: (p) => p.backend }),
  }),
});

// --- Artifacts ----------------------------------------------------------------------

interface ArtifactRow {
  id: string;
  kind: string;
  name: string;
  source: string;
  meta: unknown;
  created_at: Date;
}

interface EventLogInfo {
  filename: string | null;
  numTraces: number | null;
  numEvents: number | null;
  numVariants: number | null;
  activities: string[];
  variantsJson: string;
}
const EventLogInfoRef = builder.objectRef<EventLogInfo>("EventLogInfo");
EventLogInfoRef.implement({
  fields: (t) => ({
    filename: t.exposeString("filename", { nullable: true }),
    numTraces: t.exposeInt("numTraces", { nullable: true }),
    numEvents: t.exposeInt("numEvents", { nullable: true }),
    numVariants: t.exposeInt("numVariants", { nullable: true }),
    activities: t.exposeStringList("activities"),
    variantsJson: t.exposeString("variantsJson"),
  }),
});

interface ModelInfo {
  tool: string | null;
  svg: string | null;
  dot: string | null;
  bpmnXml: string | null;
  paramsJson: string;
  metricsJson: string;
}
const ModelInfoRef = builder.objectRef<ModelInfo>("ModelInfo");
ModelInfoRef.implement({
  fields: (t) => ({
    tool: t.exposeString("tool", { nullable: true }),
    svg: t.exposeString("svg", { nullable: true }),
    dot: t.exposeString("dot", { nullable: true }),
    bpmnXml: t.exposeString("bpmnXml", { nullable: true }),
    paramsJson: t.exposeString("paramsJson"),
    metricsJson: t.exposeString("metricsJson"),
  }),
});

async function loadModelInfo(artifactId: string): Promise<ModelInfo | null> {
  const m = await db
    .selectFrom("models")
    .selectAll()
    .where("artifact_id", "=", artifactId)
    .executeTakeFirst();
  if (!m) return null;
  const ev = await db
    .selectFrom("evaluations")
    .select("metrics")
    .where("model_id", "=", m.id)
    .orderBy("created_at", "desc")
    .executeTakeFirst();
  return {
    tool: m.tool,
    svg: m.svg,
    dot: m.dot,
    bpmnXml: m.bpmn_xml,
    paramsJson: S(m.params),
    metricsJson: S(ev?.metrics ?? null),
  };
}

const ArtifactRef = builder.objectRef<ArtifactRow>("Artifact");
ArtifactRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    kind: t.exposeString("kind"),
    name: t.exposeString("name"),
    source: t.exposeString("source"),
    metaJson: t.string({ resolve: (a) => S(a.meta) }),
    createdAt: t.string({ resolve: (a) => a.created_at.toISOString() }),
    eventLog: t.field({
      type: EventLogInfoRef,
      nullable: true,
      resolve: async (a) => {
        const ev = await db
          .selectFrom("event_logs")
          .select([
            "filename",
            "num_traces",
            "num_events",
            "num_variants",
            "activities",
            "variants",
          ])
          .where("artifact_id", "=", a.id)
          .executeTakeFirst();
        if (!ev) return null;
        return {
          filename: ev.filename,
          numTraces: ev.num_traces,
          numEvents: ev.num_events,
          numVariants: ev.num_variants,
          activities: (ev.activities as string[]) ?? [],
          variantsJson: S(ev.variants),
        };
      },
    }),
    rulesJson: t.string({
      nullable: true,
      resolve: async (a) => {
        const rs = await db
          .selectFrom("rule_sets")
          .select("rules")
          .where("artifact_id", "=", a.id)
          .executeTakeFirst();
        return rs ? S(rs.rules) : null;
      },
    }),
    model: t.field({
      type: ModelInfoRef,
      nullable: true,
      resolve: (a) => loadModelInfo(a.id),
    }),
  }),
});

// --- Jobs ---------------------------------------------------------------------------

interface JobRow {
  id: string;
  kind: string;
  status: string;
  progress: number;
  message: string | null;
  error: string | null;
  result: unknown;
  created_at: Date;
  updated_at: Date;
}
const JobRef = builder.objectRef<JobRow>("Job");
JobRef.implement({
  fields: (t) => ({
    id: t.exposeString("id"),
    kind: t.exposeString("kind"),
    status: t.exposeString("status"),
    progress: t.exposeFloat("progress"),
    message: t.exposeString("message", { nullable: true }),
    error: t.exposeString("error", { nullable: true }),
    resultJson: t.string({ nullable: true, resolve: (j) => (j.result == null ? null : S(j.result)) }),
    createdAt: t.string({ resolve: (j) => j.created_at.toISOString() }),
    updatedAt: t.string({ resolve: (j) => j.updated_at.toISOString() }),
  }),
});

// --- Activity log ---------------------------------------------------------------------

interface ActivityRow {
  id: number;
  level: string;
  source: string;
  action: string;
  detail: unknown;
  created_at: Date;
}
const ActivityRef = builder.objectRef<ActivityRow>("ActivityEntry");
ActivityRef.implement({
  fields: (t) => ({
    id: t.exposeInt("id"),
    level: t.exposeString("level"),
    source: t.exposeString("source"),
    action: t.exposeString("action"),
    detailJson: t.string({ resolve: (a) => S(a.detail) }),
    createdAt: t.string({ resolve: (a) => a.created_at.toISOString() }),
  }),
});

// --- Compare (model + evaluation, one row per discovered model) ------------------------

interface ModelCard {
  artifactId: string;
  name: string;
  tool: string | null;
  svg: string | null;
  bpmnXml: string | null;
  paramsJson: string;
  metricsJson: string;
  metaJson: string;
  createdAt: Date;
}
const ModelCardRef = builder.objectRef<ModelCard>("ModelCard");
ModelCardRef.implement({
  fields: (t) => ({
    artifactId: t.exposeString("artifactId"),
    name: t.exposeString("name"),
    tool: t.exposeString("tool", { nullable: true }),
    svg: t.exposeString("svg", { nullable: true }),
    bpmnXml: t.exposeString("bpmnXml", { nullable: true }),
    paramsJson: t.exposeString("paramsJson"),
    metricsJson: t.exposeString("metricsJson"),
    metaJson: t.exposeString("metaJson"),
    createdAt: t.string({ resolve: (m) => m.createdAt.toISOString() }),
  }),
});

// --- Query ----------------------------------------------------------------------------

builder.queryType({
  fields: (t) => ({
    health: t.field({
      type: HealthRef,
      resolve: async (): Promise<HealthShape> => {
        let b: BackendHealth;
        try {
          b = await backend.health();
        } catch {
          b = { status: "unavailable", service: "backend" };
        }
        return { bff: "ok", backend: b, dbOk: await dbHealthy() };
      },
    }),

    artifacts: t.field({
      type: [ArtifactRef],
      args: {
        sessionId: t.arg.string({ required: true }),
        kind: t.arg.string(),
      },
      resolve: async (_, args) => {
        let q = db
          .selectFrom("artifacts")
          .select(["id", "kind", "name", "source", "meta", "created_at"])
          .where("session_id", "=", args.sessionId)
          .orderBy("created_at", "desc");
        if (args.kind) q = q.where("kind", "=", args.kind);
        return (await q.execute()).map((r) => ({ ...r, created_at: D(r.created_at) }));
      },
    }),

    artifact: t.field({
      type: ArtifactRef,
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, args) => {
        const r = await db
          .selectFrom("artifacts")
          .select(["id", "kind", "name", "source", "meta", "created_at"])
          .where("id", "=", args.id)
          .executeTakeFirst();
        return r ? { ...r, created_at: D(r.created_at) } : null;
      },
    }),

    job: t.field({
      type: JobRef,
      nullable: true,
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, args) => {
        const r = await db
          .selectFrom("jobs")
          .select([
            "id",
            "kind",
            "status",
            "progress",
            "message",
            "error",
            "result",
            "created_at",
            "updated_at",
          ])
          .where("id", "=", args.id)
          .executeTakeFirst();
        return r
          ? { ...r, created_at: D(r.created_at), updated_at: D(r.updated_at) }
          : null;
      },
    }),

    jobs: t.field({
      type: [JobRef],
      args: {
        sessionId: t.arg.string({ required: true }),
        limit: t.arg.int({ defaultValue: 20 }),
      },
      resolve: async (_, args) =>
        (
          await db
            .selectFrom("jobs")
            .select([
              "id",
              "kind",
              "status",
              "progress",
              "message",
              "error",
              "result",
              "created_at",
              "updated_at",
            ])
            .where("session_id", "=", args.sessionId)
            .orderBy("created_at", "desc")
            .limit(args.limit ?? 20)
            .execute()
        ).map((r) => ({ ...r, created_at: D(r.created_at), updated_at: D(r.updated_at) })),
    }),

    activity: t.field({
      type: [ActivityRef],
      args: {
        sessionId: t.arg.string(),
        limit: t.arg.int({ defaultValue: 200 }),
      },
      resolve: async (_, args) => {
        let q = db
          .selectFrom("activity_log")
          .select(["id", "level", "source", "action", "detail", "created_at"])
          .orderBy("created_at", "desc")
          .limit(Math.min(args.limit ?? 200, 500));
        if (args.sessionId) q = q.where("session_id", "=", args.sessionId);
        return (await q.execute()).map((r) => ({ ...r, created_at: D(r.created_at) }));
      },
    }),

    models: t.field({
      type: [ModelCardRef],
      args: { sessionId: t.arg.string({ required: true }) },
      resolve: async (_, args) => {
        const rows = await db
          .selectFrom("artifacts")
          .innerJoin("models", "models.artifact_id", "artifacts.id")
          .leftJoin("evaluations", "evaluations.model_id", "models.id")
          .select([
            "artifacts.id as artifactId",
            "artifacts.name as name",
            "artifacts.meta as meta",
            "artifacts.created_at as createdAt",
            "models.tool as tool",
            "models.svg as svg",
            "models.bpmn_xml as bpmnXml",
            "models.params as params",
            "evaluations.metrics as metrics",
          ])
          .where("artifacts.session_id", "=", args.sessionId)
          .where("artifacts.kind", "=", "model")
          .orderBy("artifacts.created_at", "desc")
          .execute();
        return rows.map((r) => ({
          artifactId: r.artifactId,
          name: r.name,
          tool: r.tool,
          svg: r.svg,
          bpmnXml: r.bpmnXml,
          paramsJson: S(r.params),
          metricsJson: S(r.metrics),
          metaJson: S(r.meta),
          createdAt: D(r.createdAt),
        }));
      },
    }),
  }),
});

// --- Mutation ---------------------------------------------------------------------------

builder.mutationType({
  fields: (t) => ({
    createSession: t.string({
      resolve: async () => (await backend.createSession()).id,
    }),

    loadSampleData: t.string({
      args: { sessionId: t.arg.string({ required: true }) },
      resolve: async (_, a) => S(await backend.loadSampleData(a.sessionId)),
    }),

    deleteArtifact: t.boolean({
      args: { id: t.arg.string({ required: true }) },
      resolve: async (_, a) => {
        await backend.deleteArtifact(a.id);
        return true;
      },
    }),

    setArtifactKind: t.boolean({
      args: {
        id: t.arg.string({ required: true }),
        kind: t.arg.string({ required: true }),
      },
      resolve: async (_, a) => {
        await backend.setArtifactKind(a.id, a.kind);
        return true;
      },
    }),

    startImbi: t.string({
      args: {
        sessionId: t.arg.string({ required: true }),
        lpArtifact: t.arg.string({ required: true }),
        lmArtifact: t.arg.string({ required: true }),
        sup: t.arg.float({ required: true }),
        ratio: t.arg.float({ required: true }),
      },
      resolve: async (_, a) =>
        (
          await backend.startImbi({
            session_id: a.sessionId,
            lp_artifact: a.lpArtifact,
            lm_artifact: a.lmArtifact,
            sup: a.sup,
            ratio: a.ratio,
          })
        ).job_id,
    }),

    startImr: t.string({
      args: {
        sessionId: t.arg.string({ required: true }),
        logArtifact: t.arg.string({ required: true }),
        sup: t.arg.float({ required: true }),
        rulesJson: t.arg.string({ required: true }),
        activities: t.arg.stringList({ required: true }),
      },
      resolve: async (_, a) =>
        (
          await backend.startImr({
            session_id: a.sessionId,
            log_artifact: a.logArtifact,
            sup: a.sup,
            rules: JSON.parse(a.rulesJson) as unknown[],
            activities: [...a.activities],
          })
        ).job_id,
    }),

    startImf: t.string({
      args: {
        sessionId: t.arg.string({ required: true }),
        logArtifact: t.arg.string({ required: true }),
        noiseThreshold: t.arg.float({ required: true }),
      },
      resolve: async (_, a) =>
        (
          await backend.startImf({
            session_id: a.sessionId,
            log_artifact: a.logArtifact,
            noise_threshold: a.noiseThreshold,
          })
        ).job_id,
    }),

    startEvaluateModels: t.string({
      args: {
        sessionId: t.arg.string({ required: true }),
        modelArtifacts: t.arg.stringList({ required: true }),
        lpArtifact: t.arg.string({ required: true }),
        lmArtifact: t.arg.string({ required: true }),
      },
      resolve: async (_, a) =>
        (
          await backend.startEvaluateModels({
            session_id: a.sessionId,
            model_artifacts: [...a.modelArtifacts],
            lp_artifact: a.lpArtifact,
            lm_artifact: a.lmArtifact,
          })
        ).job_id,
    }),

    startXpviEmd: t.string({
      args: {
        sessionId: t.arg.string({ required: true }),
        logArtifact: t.arg.string({ required: true }),
        nBin: t.arg.int({ required: true }),
        w: t.arg.int({ required: true }),
        kpi: t.arg.string({ required: true }),
      },
      resolve: async (_, a) =>
        (
          await backend.startXpviEmd({
            session_id: a.sessionId,
            log_artifact: a.logArtifact,
            n_bin: a.nBin,
            w: a.w,
            kpi: a.kpi,
          })
        ).job_id,
    }),

    startXpviSegment: t.string({
      args: {
        sessionId: t.arg.string({ required: true }),
        nBin: t.arg.int({ required: true }),
        w: t.arg.int({ required: true }),
        kpi: t.arg.string({ required: true }),
        signalThreshold: t.arg.float({ required: true }),
        logArtifact: t.arg.string(),
      },
      resolve: async (_, a) =>
        (
          await backend.startXpviSegment({
            session_id: a.sessionId,
            n_bin: a.nBin,
            w: a.w,
            kpi: a.kpi,
            signal_threshold: a.signalThreshold,
            log_artifact: a.logArtifact ?? null,
          })
        ).job_id,
    }),

    startXpviExport: t.string({
      args: { sessionId: t.arg.string({ required: true }) },
      resolve: async (_, a) =>
        (await backend.startXpviExport({ session_id: a.sessionId })).job_id,
    }),

    startXpviExplain: t.string({
      args: {
        sessionId: t.arg.string({ required: true }),
        nBin: t.arg.int({ required: true }),
        w: t.arg.int({ required: true }),
        kpi: t.arg.string({ required: true }),
        thetaCvg: t.arg.float({ required: true }),
        nClusters: t.arg.int({ required: true }),
        signalThreshold: t.arg.float({ required: true }),
        logArtifact: t.arg.string(),
      },
      resolve: async (_, a) =>
        (
          await backend.startXpviExplain({
            session_id: a.sessionId,
            n_bin: a.nBin,
            w: a.w,
            kpi: a.kpi,
            theta_cvg: a.thetaCvg,
            n_clusters: a.nClusters,
            signal_threshold: a.signalThreshold,
            log_artifact: a.logArtifact ?? null,
          })
        ).job_id,
    }),

    xpviExplainNl: t.string({
      args: {
        sessionId: t.arg.string({ required: true }),
        cluster: t.arg.int({ required: true }),
        segment: t.arg.int({ required: true }),
      },
      resolve: async (_, a) =>
        S(
          await backend.xpviExplainNl({
            session_id: a.sessionId,
            cluster: a.cluster,
            segment: a.segment,
          }),
        ),
    }),

    startDiscriminate: t.string({
      args: {
        sessionId: t.arg.string({ required: true }),
        lpArtifact: t.arg.string({ required: true }),
        lmArtifact: t.arg.string({ required: true }),
      },
      resolve: async (_, a) =>
        (
          await backend.startDiscriminate({
            session_id: a.sessionId,
            lp_artifact: a.lpArtifact,
            lm_artifact: a.lmArtifact,
          })
        ).job_id,
    }),

    startCluster: t.string({
      args: {
        sessionId: t.arg.string({ required: true }),
        nClusters: t.arg.int({ required: true }),
        zJson: t.arg.string({ required: true }),
      },
      resolve: async (_, a) =>
        (
          await backend.startCluster({
            session_id: a.sessionId,
            n_clusters: a.nClusters,
            Z: JSON.parse(a.zJson) as unknown[],
          })
        ).job_id,
    }),

    startDiscoverRules: t.string({
      args: {
        sessionId: t.arg.string({ required: true }),
        logArtifact: t.arg.string({ required: true }),
        support: t.arg.float({ required: true }),
        confidence: t.arg.float({ required: true }),
      },
      resolve: async (_, a) =>
        (
          await backend.startDiscoverRules({
            session_id: a.sessionId,
            log_artifact: a.logArtifact,
            support: a.support,
            confidence: a.confidence,
          })
        ).job_id,
    }),

    // Synchronous: the API key flows request→backend→LLM provider and is never stored.
    extractLlmRules: t.string({
      args: {
        sessionId: t.arg.string({ required: true }),
        logArtifact: t.arg.string({ required: true }),
        description: t.arg.string({ required: true }),
        provider: t.arg.string({ required: true }),
        modelName: t.arg.string({ required: true }),
        apiKey: t.arg.string({ required: true }),
        historyJson: t.arg.string(),
      },
      resolve: async (_, a) =>
        S(
          await backend.extractLlmRules({
            session_id: a.sessionId,
            log_artifact: a.logArtifact,
            description: a.description,
            provider: a.provider,
            model_name: a.modelName,
            api_key: a.apiKey,
            history: JSON.parse(a.historyJson ?? "[]") as unknown[],
          }),
        ),
    }),

    saveRules: t.string({
      args: {
        sessionId: t.arg.string({ required: true }),
        name: t.arg.string({ required: true }),
        rulesJson: t.arg.string({ required: true }),
      },
      resolve: async (_, a) =>
        (
          await backend.saveRules({
            session_id: a.sessionId,
            name: a.name,
            rules: JSON.parse(a.rulesJson) as unknown[],
          })
        ).artifact_id,
    }),

    scoreRules: t.string({
      args: {
        sessionId: t.arg.string({ required: true }),
        logArtifact: t.arg.string({ required: true }),
        rulesJson: t.arg.string({ required: true }),
      },
      resolve: async (_, a) =>
        S(
          (
            await backend.scoreRules({
              session_id: a.sessionId,
              log_artifact: a.logArtifact,
              rules: JSON.parse(a.rulesJson) as unknown[],
            })
          ).rules,
        ),
    }),

    edgeTimes: t.string({
      args: { artifactId: t.arg.string({ required: true }) },
      resolve: async (_, a) => S((await backend.edgeTimes(a.artifactId)).edges),
    }),

    xpviInspect: t.string({
      args: {
        sessionId: t.arg.string({ required: true }),
        logArtifact: t.arg.string({ required: true }),
      },
      resolve: async (_, a) =>
        S(
          await backend.xpviInspect({
            session_id: a.sessionId,
            log_artifact: a.logArtifact,
          }),
        ),
    }),
  }),
});

export const schema = builder.toSchema();
