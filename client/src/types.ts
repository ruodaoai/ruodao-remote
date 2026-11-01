export interface Settings {
  serverUrl: string;
  deviceName: string;
  autoStartHost: boolean;
  preferredCode: string;
  keyPersisted: boolean;
  deviceId: string;
  inviteCode: string;
  adminReady: boolean;
  adminServerUrl: string;
  localServerEnabled: boolean;
  localServerPort: number;
  localServerPublicUrl: string;
  launchAtLogin: boolean;
  autoUpdate: boolean;
}

export type SettingsPatch = Partial<
  Pick<
    Settings,
    | "serverUrl"
    | "deviceName"
    | "autoStartHost"
    | "preferredCode"
    | "inviteCode"
    | "localServerEnabled"
    | "localServerPort"
    | "localServerPublicUrl"
    | "launchAtLogin"
    | "autoUpdate"
  >
>;

export interface AppInfo {
  version: string;
  platform: string;
  inputAvailable: boolean;
  smoke: boolean;
}

export type UpdatePhase =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error";

export interface UpdateReleaseSummary {
  version: string;
  notes: string;
  publishedAt: string | null;
  mandatory: boolean;
  size: number | null;
  assetName: string;
  kind: string;
}

export interface UpdateStatus {
  supported: boolean;
  reason: string | null;
  phase: UpdatePhase;
  currentVersion: string;
  autoUpdate: boolean;
  lastCheckedAt: number | null;
  release: UpdateReleaseSummary | null;
  progress: { received: number; total: number; percent: number } | null;
  error: string | null;
  portable: boolean;
  readyToInstall: boolean;
  updateBaseUrl: string;
}

export interface AdminUpdateStatus {
  supported: boolean;
  enabled: boolean;
  reason: string | null;
  currentVersion: string;
  channel: string;
  phase: "idle" | "checking" | "available" | "downloading" | "ready" | "applying" | "up-to-date" | "error";
  latest: { version: string; notes: string; publishedAt: string | null; size: number | null; assetName: string } | null;
  staged: { version: string; path: string; size: number | null; sha256: string } | null;
  lastCheckedAt: number | null;
  autoApply: boolean;
  applyMode: "auto" | "manual" | "system";
  systemUpdater: boolean;
  manualCommand: string | null;
  error: string | null;
}

export interface SavedKey {
  key: string;
  salt: string;
}

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

export interface HostSessionInfo {
  sessionId: string;
  controllerName: string;
  platform: string;
  ip?: string;
  startedAt: number;
  endsAt?: number | null;
}

export interface SessionStats {
  kbps: number;
  fps: number;
  width: number;
  height: number;
  rttMs: number;
  jitterMs: number;
  lossPct: number;
}

export interface ServerStats {
  at: number;
  bandwidthInKbps: number;
  bandwidthOutKbps: number;
  wsInKbps: number;
  wsOutKbps: number;
  sessionKbps: number;
  sessions: number;
  maxSessions: number;
  remainingSlots: number | null;
  peers: number;
  load1: number;
  cpuPct: number;
  lagMs: number;
  memoryPct: number;
  uptimeSeconds: number;
  sessionLimitMinutes: number;
  cooldownMinutes: number;
  activeBlocks: number;
  activeCooldowns: number;
}

export interface SessionLogDangerEvent {
  at: number;
  action: string;
  label: string;
}

export interface SessionLogEntry {
  id: string;
  recordedAt: number;
  startedAt: number;
  durationMs: number;
  role: "host" | "controller";
  peerName: string;
  peerIp: string | null;
  peerPlatform: string;
  sessionId: string;
  reason: string;
  dangerEvents: SessionLogDangerEvent[];
}

export type QualityPreset = "smooth" | "balanced" | "sharp";

export interface SessionChatMessage {
  id: number;
  from: "self" | "peer";
  text: string;
  at: number;
}

export interface PeerProfile {
  name: string;
  platform: string;
  ip?: string;
}

export type AdminTarget = "remote" | "local";

export interface LocalServerStatus {
  running: boolean;
  starting: boolean;
  port: number;
  url: string;
  publicUrl: string;
  lanUrls: string[];
  adminPasswordReady: boolean;
  startedAt: number | null;
  error: string | null;
  dataDir: string;
}

export type RegistrationMode = "invite" | "approval" | "open";

export interface DeployConfig {
  host: string;
  sshPort: number;
  username: string;
  password: string;
  privateKeyPath: string;
  passphrase: string;
  domain: string;
  registrationMode: RegistrationMode;
  installTurn: boolean;
}

export type DeployStepId =
  | "connect"
  | "inspect"
  | "packages"
  | "turn"
  | "server"
  | "updates"
  | "proxy"
  | "firewall"
  | "defense"
  | "verify"
  | "finish";

export type DeployStepStatus = "pending" | "running" | "success" | "error" | "skipped";

export interface DeployStep {
  id: DeployStepId;
  title: string;
  detail: string;
  status: DeployStepStatus;
  note: string;
}

export interface DeployResult {
  serverUrl: string;
  host: string;
  domain: string;
  adminPassword: string;
  adminPersisted: boolean;
  secure: boolean;
  turn: boolean;
  version: string;
  reusedPassword: boolean;
  inviteCode: string;
  registrationMode: RegistrationMode;
  publicPort: number;
  redirectPort: number;
  internalPort: number;
  turnPort: number;
  relayMin: number;
  relayMax: number;
  adminPath: string;
}

export type DeployEvent =
  | { type: "step"; step: DeployStep }
  | { type: "log"; line: string; stream: "stdout" | "stderr" }
  | {
      type: "host-key";
      prompt: { host: string; port: number; fingerprint: string; previous: string | null };
    }
  | { type: "done"; result: DeployResult }
  | { type: "error"; message: string; step: DeployStepId | null; log: string[] }
  | { type: "cancelled" };

export type AdminDeviceStatus = "pending" | "approved" | "blocked";

export interface AdminStatus {
  target: AdminTarget;
  serverUrl: string;
  configured: boolean;
  session: boolean;
  expiresAt: number | null;
}

export interface AdminResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

export interface AdminServerInfo {
  name: string;
  version: string;
  publicUrl: string;
  registrationMode: RegistrationMode;
  uptimeSeconds?: number;
  startedAt?: number;
}

export interface ServerPolicy {
  maxSessions: number;
  sessionLimitMinutes: number;
  cooldownMinutes: number;
  freezeMinutes: number;
}

export type AccessBlockKind = "device" | "ip";

export interface AccessBlock {
  id: string;
  kind: AccessBlockKind;
  value: string;
  label: string;
  reason: string;
  createdAt: number;
  createdBy: string;
  expiresAt: number | null;
}

export interface CooldownRecord {
  key: string;
  label: string;
  until: number;
  reason: string;
}

export interface AdminStats {
  peers: number;
  hosts: number;
  sessions: number;
  onlineDevices: number;
  approvedDevices: number;
  pendingDevices: number;
  blockedDevices: number;
  activeSessions: number;
  activeInvites: number;
  publishedHosts?: number;
  pendingRequests?: number;
  sessionKbps?: number;
  maxSessions?: number;
  remainingSlots?: number | null;
  activeCooldowns?: number;
  activeBlocks?: number;
}

export interface AdminNetworkInfo {
  at: number;
  bandwidthInKbps: number;
  bandwidthOutKbps: number;
  wsInKbps: number;
  wsOutKbps: number;
  load1: number;
  cpuPct: number;
  lagMs: number;
  memoryPct: number;
  memoryMb: number;
  uptimeSeconds: number;
  nicSupported: boolean;
}

export interface AdminSecurityInfo {
  connections: number;
  trackedIps: number;
  activeBans: number;
}

export interface AdminOverview {
  server: AdminServerInfo;
  stats: AdminStats;
  network?: AdminNetworkInfo | null;
  security?: AdminSecurityInfo;
  policy?: ServerPolicy;
  blocks?: AccessBlock[];
  cooldowns?: CooldownRecord[];
}

export interface AdminDevice {
  id: string;
  name: string;
  platform: string;
  version: string;
  status: AdminDeviceStatus;
  firstSeen: number;
  lastSeen: number;
  lastIp: string;
  inviteCode: string | null;
  online: boolean;
  roles: Array<"host" | "controller">;
  ip: string;
  code: string | null;
  sessionId: string | null;
  connectedAt: number | null;
}

export interface AdminInvite {
  code: string;
  label: string;
  createdAt: number;
  createdBy: string;
  expiresAt: number | null;
  maxUses: number;
  uses: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  usedBy: string[];
  active: boolean;
}

export interface AdminSessionTelemetry {
  kbps: number;
  fps: number;
  width: number;
  height: number;
  rttMs: number;
  jitterMs: number;
  lossPct: number;
  reporter: "host" | "controller";
  updatedAt: number;
}

export interface AdminSessionInfo {
  id: string;
  code: string;
  createdAt: number;
  endsAt?: number | null;
  durationMs: number;
  telemetry: AdminSessionTelemetry | null;
  dangerEvents: SessionLogDangerEvent[];
  host: { deviceId: string | null; name: string; platform: string; ip: string };
  controller: { deviceId: string | null; name: string; platform: string; ip: string };
}

export interface AdminSessionRecord {
  id: string;
  code: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  reason: string;
  host: { deviceId: string | null; name: string; ip: string };
  controller: { deviceId: string | null; name: string; ip: string };
  telemetry: AdminSessionTelemetry | null;
  dangerEvents: SessionLogDangerEvent[];
}

export interface AdminActivityEntry {
  id: string;
  at: number;
  action: string;
  actor: string;
  deviceId?: string;
  detail?: string;
}

export interface AssistantUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  role: string;
}

export interface AssistantModel {
  id: string;
  label: string;
  modelName: string;
  modelConfigId: string;
  inputTypes: string[];
}

export interface AssistantChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantStatus {
  authenticated: boolean;
  sessionExpired: boolean;
  email: string;
  user: AssistantUser | null;
  models: AssistantModel[];
  defaultModel: string;
  model: string;
  modelsError: string | null;
  persistAvailable: boolean;
  apiBaseUrl: string;
}

export interface AssistantReply {
  content: string;
  model: string;
  modelConfigId: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
}

export type SharedServerSort = "recommended" | "newest" | "expiring";

export interface SharedServerInfo {
  id: string;
  name: string;
  address: string;
  host: string;
  region: string;
  specs: string;
  maxDevices: number | null;
  inviteCode: string;
  note: string;
  expiresAt: string;
  status: string;
  online: boolean;
  healthStatus: string;
  serverVersion: string;
  registrationMode: string;
  peers: number | null;
  sessions: number | null;
  lastCheckedAt: string | null;
  createdAt: string | null;
}

export interface SharedServerPage {
  items: SharedServerInfo[];
  total: number;
  page: number;
  size: number;
}

export interface SharedServerFormInput {
  name: string;
  address: string;
  region: string;
  specs: string;
  maxDevices: number | null;
  inviteCode: string;
  note: string;
  expiresAt: string;
}

export interface SharedServerMineEntry {
  id: string;
  addedAt: number;
  syncedAt: number;
  gone: boolean;
  server: SharedServerInfo | null;
  error: string | null;
}

export interface SharedServerMineState {
  entries: SharedServerMineEntry[];
  refreshedAt: number | null;
}

export type CommunitySource = "plugin-market" | "ecosystem";

export interface CommunityApp {
  id: string;
  slug: string;
  name: string;
  summary: string;
  iconUrl: string;
  pagePath: string;
  source: CommunitySource;
  authorUserId: string;
  submittedByMe: boolean;
}

export interface CommunityReply {
  content: string;
  createdAt: string;
}

export interface CommunityReview {
  id: string;
  rating: number;
  content: string;
  userLabel: string;
  userAvatarUrl: string;
  verified: boolean;
  createdAt: string;
  helpful: boolean;
  helpfulCount: number;
  authorReply: CommunityReply | null;
  mine: boolean;
}

export interface CommunitySummary {
  ratingAvg: number;
  ratingCount: number;
  distribution: number[];
  tipCount: number;
  tipTotal: number;
}

export interface CommunityThread {
  app: CommunityApp;
  summary: CommunitySummary;
  items: CommunityReview[];
  myReview: CommunityReview | null;
  total: number;
  page: number;
  size: number;
  signedIn: boolean;
  isOwner: boolean;
}
