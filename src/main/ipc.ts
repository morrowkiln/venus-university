import type { WhisperDraft, WhisperReply } from '@shared/venusWhisper'
import type { MeanwhileResponse } from '@shared/meanwhile'
import { prepareStoryRequest, inspectStoryMemory } from './services/storyMemoryService'
import type { StoryRecallRequest } from '@shared/storyMemory'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
  type SaveDialogOptions,
  type SaveDialogReturnValue
} from 'electron'
import { randomUUID } from 'crypto'
import type { ModSwitches } from '@shared/mods'
import type {
  AppError,
  Character,
  CharacterBrief,
  ComfyStatus,
  CustomOutfitSlot,
  Emotion,
  EndingPostsResponse,
  EnrollmentDraft,
  GrabBags,
  HangoutClassifierResponse,
  ImageCandidate,
  ImageEndpointCandidate,
  InstallProgress,
  JobProgress,
  LedgerResponse,
  OutfitSet,
  Position,
  ProfileCrop,
  PlaythroughDraft,
  ReferenceImage,
  Result,
  SaveDraft,
  SceneResponse,
  SetTarget,
  SettingsPatch,
  SlotIntroResponse,
  TextingResponse,
  WardrobeFixImage,
  WardrobeLayer,
  WardrobeTarget,
  WriterCandidate
} from '@shared/types'
import { MAX_LOG_RECORD_CHARS } from '@shared/types'
import type { ClassifierPromptRequest } from '@shared/classifier'
import type { PromptEdit } from '@shared/imagePrompt'
import type { RoomVariant } from '@shared/room'
import { appError, toAppError, truncate } from '@shared/errors'
import { renamePlaythrough } from './services/playthroughNameService'
import {
  getAvailablePoses,
  getQuickstart,
  readAudio
} from './services/assetService'
import {
  createPlaythrough,
  deletePlaythrough,
  deleteSave,
  listPlaythroughs,
  listSaves,
  overwriteSlotSave,
  readEnrollment,
  readSave,
  writeAutosave,
  writeEnrollment,
  writeManualSave,
  writeSlotSave
} from './services/saveService'
import { readBreak, removeBreak, writeBreak } from './services/breakService'
import type { BreakDraft } from '@shared/termBreak'
import {
  applyWardrobeFix,
  decodePng,
  assertEditableChar,
  assertSafeCharId,
  commitStagedSet,
  createCharacter,
  deleteCharacter,
  deleteCustomSet,
  discardStaged,
  discardWardrobeLayer,
  getCgStatus,
  getCharacter,
  getDefaultsStatus,
  getExpressionStatus,
  getOutfitStatus,
  getProfileCrop,
  getRoomStatus,
  hasBaseImage,
  listCharacters,
  readCharacterImage,
  readReference,
  readWardrobeImage,
  restoreDefaults,
  setProfileCrop,
  writeCharacter
} from './services/characterService'
import {
  duplicateCharacter,
  exportCharacter,
  importCharacter,
  saveExportFile
} from './services/characterTransferService'
import { exportBackup, importBackup } from './services/backupService'
import { exportLocalPhotos, importLocalPhotos } from './localPhotoBackup'
import { soundtrackLibrary, pickSoundtrack } from './services/soundtrackService'
import {
  addCustomBackground,
  listCustomBackgrounds,
  readCustomBackgroundImage,
  removeCustomBackground
} from './services/backgroundService'
import {
  fixHands,
  generateCg,
  generateSprite,
  setStateSink as setComfyStateSink,
  start as startComfy,
  stopByHand as stopComfyByHand
} from './services/comfyService'
import { classifyCloud } from '@shared/llm/cloudClassifier'
import { generatePhoto } from '@shared/llm/cloudImage'
import { completeStructured as completeCloudStructured, type StructuredRequest } from '@shared/llm/cloudLlm'
import {
  listImageModels,
  listModels,
  photoModelChoice,
  testImages,
  testWriter
} from '@shared/llm/endpointProbe'
import { backupName } from '@shared/backup'
import { photoExportName, type PhotoMeta, type PhotoRequest } from '@shared/photos'
import { exportFileName } from '@shared/characterTransfer'
import { ENDING_ART_FILE_NAME } from '@shared/endingPicture'
import type { ExportKind } from '@shared/sillyTavern'
import { useSettingsSource } from '@shared/llm/settingsPort'
import { setTokenSink } from '@shared/llm/tokenPort'
import { logExportName, logRecordOf } from '@shared/logRules'
import { storedEndpointKeyFor } from '@shared/settingsRules'
import {
  cancelGroup,
  cancelKeys,
  enqueue,
  runAbortable,
  setProgressSink
} from '@shared/jobQueue'
import { registerPhotoIpc } from './photoIpc'
import { copyEndingArtTo, generateEndingArt, readEndingArt } from './services/endingArtService'
import {
  deleteProfilePicture,
  readProfilePicture,
  writeProfilePicture
} from './services/profilePictureService'
import {
  copyPhotoTo,
  deletePhoto,
  listPhotos,
  readPhoto,
  writePhoto,
  writePhotoThumb
} from './services/photoService'
import { generateRoomImage, writeRoomUpload } from './services/roomService'
import { applySettingsPatch, getRendererSettings, getSettings } from './services/settingsService'
import { getGrabBags, setGrabBags } from './services/grabBagService'
import { getModSwitches, setModSwitches } from './services/modsService'
import {
  getModelFolder,
  getSetupStatus,
  runInstall,
  verifyModel
} from './services/setupService'
import { applyUpdate, getUpdateCheck } from './services/updateService'
import { copyLogTo, writeLogLine } from './logFile'
import { getCharacterPath } from './paths'
import { redactError } from './redact'

/** The save dialog, parented on the asking window so it is window-modal. */
function showSaveDialogFor(
  event: IpcMainInvokeEvent,
  options: SaveDialogOptions
): Promise<SaveDialogReturnValue> {
  const owner = BrowserWindow.fromWebContents(event.sender)
  return owner === null ? dialog.showSaveDialog(options) : dialog.showSaveDialog(owner, options)
}

/** {@link showSaveDialogFor}'s other half, for picking a file that exists. */
function showOpenDialogFor(
  event: IpcMainInvokeEvent,
  options: OpenDialogOptions
): Promise<OpenDialogReturnValue> {
  const owner = BrowserWindow.fromWebContents(event.sender)
  return owner === null ? dialog.showOpenDialog(options) : dialog.showOpenDialog(owner, options)
}

/** Registers an `ipcMain.handle` that always resolves to a {@link Result}. */
function handle<Args extends unknown[], T>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: Args) => Promise<T> | T
): void {
  ipcMain.handle(channel, async (event, ...args: Args): Promise<Result<T>> => {
    try {
      const data = await listener(event, ...args)
      return { ok: true, data }
    } catch (err) {
      const error = redactError(toAppError(err))
      // Every failure but a cancellation is logged here; the renderer only decides what to show.
      // The console gets the thrown value whole, for its stack; the log redacts what it writes.
      if (error.code !== 'CANCELLED') console.error(`[ipc] ${channel} failed:`, err)
      return { ok: false, error }
    }
  })
}

/** One event on its way to a window, with this machine's paths out of the failure it carries. */
function redactedProgress<T extends { error?: AppError }>(progress: T): T {
  if (progress.error === undefined) return progress
  return { ...progress, error: redactError(progress.error) }
}

/** Queues one ComfyUI render, grouped by charId so deleting a character cancels it. */
async function enqueueComfyJob<T>(
  character: Character,
  key: string,
  run: (options: { signal: AbortSignal; onProgress: (step: string) => void }) => Promise<T>
): Promise<T> {
  // The gate in front of every sprite channel: `/assets` is read-only.
  await assertEditableChar(character.charId)
  return enqueue({
    group: character.charId,
    key,
    run: async ({ signal, report }) => {
      // The job starts ComfyUI itself; the queue is serial, so only the first pays the boot.
      report('Waiting for ComfyUI')
      await startComfy((step) => report(step))
      return run({ signal, onProgress: (step) => report(step) })
    }
  })
}

/** Registers every IPC channel; keep this, preload and the d.ts in sync. */
export function registerIpcHandlers(): void {
  // The photo feature's three channels, which keep their own module and their own queue.
  registerPhotoIpc(handle)
  // The key the cloud calls need never leaves main; the transport reads it through this port.
  useSettingsSource(getSettings)
  // Fixed channel: jobs can outlive their original `invoke`, so broadcast progress.
  setProgressSink((progress: JobProgress) => {
    const sent = redactedProgress(progress)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed()) window.webContents.send('jobs:progress', sent)
    }
  })
  // Fixed channel too: main owns where ComfyUI is, and jobs start it without the renderer.
  setComfyStateSink((status: ComfyStatus) => {
    const sent = redactedProgress(status)
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed()) window.webContents.send('comfy:state', sent)
    }
  })
  // Fixed channel: the count is read in the transport, which no invoke's reply carries.
  setTokenSink((generated) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.isDestroyed()) window.webContents.send('llm:tokens', generated)
    }
  })

  // Neither channel carries a key: out is a presence flag, in is a patch.
  handle('settings:get', () => getRendererSettings())
  // A write that changes the fullscreen setting puts the window there at once; any other write
  // leaves the window as F11 left it.
  handle('settings:set', async (event, patch: SettingsPatch) => {
    const wasFullscreen = (await getSettings()).fullscreen !== false
    const next = await applySettingsPatch(patch)
    const fullscreen = next.fullscreen !== false
    if (fullscreen !== wasFullscreen) {
      BrowserWindow.fromWebContents(event.sender)?.setFullScreen(fullscreen)
    }
    return next
  })
  // The grab bags' set-aside keys, read once at boot and written behind every draw.
  handle('grabBags:get', () => getGrabBags())
  handle('grabBags:set', (_event, bags: GrabBags) => setGrabBags(bags))
  handle('storyMemory:inspect', (_event, payload: StoryRecallRequest) => inspectStoryMemory(payload))
  handle('mods:get', () => getModSwitches())
  handle('mods:set', (_event, switches: ModSwitches) => setModSwitches(switches))
  // The caller has already saved; main writes nothing on its way out.
  handle('app:quit', () => {
    app.quit()
  })
  // What the launch check found, answered off the cached promise.
  handle('update:check', () => getUpdateCheck())
  // Progress goes out on a fixed push channel; the quit waits for this invoke to be answered,
  // so the renderer's await settles before the window goes away.
  handle('update:apply', async (event) => {
    await applyUpdate((progress) => {
      if (event.sender.isDestroyed()) return
      event.sender.send('update:progress', progress)
    })
    setTimeout(() => app.quit(), 250)
  })
  // The renderer's own console, appended to the file main's goes to; main stamps the clock and
  // holds what the window sent to one level of its own and one record's worth of characters.
  handle('log:write', (_event, level: unknown, text: unknown) => {
    const record = logRecordOf(level, text)
    writeLogLine('renderer', record.level, truncate(record.text, MAX_LOG_RECORD_CHARS))
  })
  // A copy of the app log, saved where the native dialog points; a dismissed dialog resolves `null`.
  handle('log:export', async (event) => {
    const { canceled, filePath } = await showSaveDialogFor(event, {
      title: 'Save game log',
      defaultPath: logExportName(),
      filters: [{ name: 'Log file', extensions: ['log', 'txt'] }]
    })
    if (canceled || filePath === undefined || filePath === '') return null

    await copyLogTo(filePath)
    return filePath
  })
  handle('setup:getStatus', () => getSetupStatus())

  // Renderer needs pose keys for prompts, but cannot read /assets.
  handle('assets:getPoseManifest', () => getAvailablePoses())

  // The canned semester behind Quickstart, read on demand.
  handle('assets:getQuickstart', () => getQuickstart())

  // The mix names a file; the renderer cannot read /assets, so the bytes come over the bridge.
  handle('assets:readAudio', (_event, file: string) => readAudio(file))
  handle('soundtracks:list', () => soundtrackLibrary.list())
  handle('soundtracks:read', (_event, key: string) => soundtrackLibrary.read(key))
  handle('soundtracks:remove', (_event, key: string) => soundtrackLibrary.remove(key))
  handle('soundtracks:loop', (_event, key: string, value: boolean) => soundtrackLibrary.loop(key, value))
  handle('soundtracks:cleanup', () => soundtrackLibrary.cleanup())
  handle('soundtracks:commit', (event, key: string, token: string, duration: number) =>
    soundtrackLibrary.commit(key, token, duration, event.sender.id))
  handle('soundtracks:pick', async event => {
    soundtrackLibrary.cancelPick()
    const picked = await showOpenDialogFor(event, {
      title: 'Choose a replacement music track', properties: ['openFile'],
      filters: [{ name: 'Music', extensions: ['mp3', 'ogg', 'wav'] }]
    })
    return picked.canceled || !picked.filePaths[0] ? null : pickSoundtrack(picked.filePaths[0], event.sender.id)
  })

  // Unqueued; the streamed deltas are preview-only and the invoke result is the
  // authoritative one. `group` is the loop's own.
  handle('llm:completeScene', (event, request: StructuredRequest, group: string) =>
    runAbortable(group, (signal) =>
      completeStructured<SceneResponse>(request, signal, (delta) =>
        event.sender.send('llm:sceneDelta', delta)
      )
    )
  )

  // The end-of-scene bookkeeping call: no deltas, its own schema.
  handle('llm:completeLedger', (_event, request: StructuredRequest, group: string) =>
    runAbortable(group, (signal) => completeStructured<LedgerResponse>(request, signal))
  )

  // The slot-opening narration: no deltas, its own schema.
  handle('llm:completeIntro', (_event, request: StructuredRequest, group: string) =>
    runAbortable(group, (signal) => completeStructured<SlotIntroResponse>(request, signal))
  )

  // The epilogue's status updates: one call for the whole week after graduation.
  handle('llm:completeEndingPosts', (_event, request: StructuredRequest, group: string) =>
    runAbortable(group, (signal) => completeStructured<EndingPostsResponse>(request, signal))
  )

  handle('llm:completeWhisper', (_event, request: StructuredRequest, group: string) =>
    runAbortable(group, signal => completeStructured<WhisperDraft | WhisperReply>(request, signal))
  )

  handle('llm:completeMeanwhile', (_event, request: StructuredRequest, group: string) =>
    runAbortable(group, signal => completeStructured<MeanwhileResponse>(request, signal))
  )

  // A Bunnyboard texting turn, streamed. Several can stream at once, so every
  // delta carries its `group` to say whose text it is.
  handle('llm:completeTexting', (event, request: StructuredRequest, group: string) =>
    runAbortable(group, (signal) =>
      completeStructured<TextingResponse>(request, signal, (delta) =>
        event.sender.send('llm:textingDelta', group, delta)
      )
    )
  )

  // The hangout classifier, run on the reply the texting call just wrote.
  handle('llm:classifyHangout', (_event, request: StructuredRequest) =>
    completeStructured<HangoutClassifierResponse>(request)
  )

  handle('saves:playthroughs', () => listPlaythroughs())
  handle('saves:rename', (_event, id: string, name: string) => renamePlaythrough(id, name))
  handle('saves:list', (_event, playthroughId: string) => listSaves(playthroughId))
  handle('saves:enroll', (_event, draft: EnrollmentDraft) => writeEnrollment(draft))
  handle('saves:enrollment', (_event, playthroughId: string) => readEnrollment(playthroughId))
  handle('saves:break', (_event, playthroughId: string) => readBreak(playthroughId))
  handle('saves:writeBreak', (_event, playthroughId: string, draft: BreakDraft) =>
    writeBreak(playthroughId, draft)
  )
  handle('saves:removeBreak', (_event, playthroughId: string) => removeBreak(playthroughId))
  handle(
    'saves:create',
    (_event, playthrough: PlaythroughDraft, draft: SaveDraft, playthroughId?: string) =>
      createPlaythrough(playthrough, draft, playthroughId)
  )
  handle('saves:slot', (_event, playthroughId: string, draft: SaveDraft) =>
    writeSlotSave(playthroughId, draft)
  )
  handle('saves:overwrite', (_event, playthroughId: string, saveId: string, draft: SaveDraft) =>
    overwriteSlotSave(playthroughId, saveId, draft)
  )
  handle('saves:autosave', (_event, playthroughId: string, draft: SaveDraft) =>
    writeAutosave(playthroughId, draft)
  )
  handle('saves:manual', (_event, playthroughId: string, slot: number, draft: SaveDraft) =>
    writeManualSave(playthroughId, slot, draft)
  )
  handle('saves:read', (_event, playthroughId: string, saveId: string) =>
    readSave(playthroughId, saveId)
  )
  handle('saves:delete', (_event, playthroughId: string, saveId: string) =>
    deleteSave(playthroughId, saveId)
  )
  // The graduation picture.
  handle(
    'saves:generateEndingArt',
    (_event, playthroughId: string, sheet: string, friendCount: number, group: string) =>
      runAbortable(group, (signal) => generateEndingArt(playthroughId, sheet, friendCount, signal))
  )
  handle('saves:readEndingArt', (_event, playthroughId: string) => readEndingArt(playthroughId))
  // A copy of the picture, saved where the native dialog points; a dismissed dialog resolves `null`.
  handle('saves:exportEndingArt', async (event, playthroughId: string) => {
    const { canceled, filePath } = await showSaveDialogFor(event, {
      title: 'Save ending CG',
      defaultPath: ENDING_ART_FILE_NAME,
      filters: [{ name: 'PNG image', extensions: ['png'] }]
    })
    if (canceled || filePath === undefined || filePath === '') return null

    await copyEndingArtTo(playthroughId, filePath)
    return filePath
  })

  // The reader's own picture.
  handle('saves:readProfilePicture', (_event, playthroughId: string) =>
    readProfilePicture(playthroughId)
  )
  handle('saves:writeProfilePicture', (_event, playthroughId: string, png: string) =>
    writeProfilePicture(playthroughId, png)
  )
  handle('saves:deleteProfilePicture', (_event, playthroughId: string) =>
    deleteProfilePicture(playthroughId)
  )

  handle('saves:deletePlaythrough', (_event, playthroughId: string) =>
    deletePlaythrough(playthroughId)
  )

  // The Bunnyboard's photos.
  handle('photos:options', () => photoModelChoice())
  handle('photos:generate', (_event, request: PhotoRequest, group: string) =>
    runAbortable(group, (signal) => generatePhoto(request, signal))
  )
  handle('photos:list', (_event, playthroughId: string) => listPhotos(playthroughId))
  handle('photos:read', (_event, playthroughId: string, photoId: string) =>
    readPhoto(playthroughId, photoId)
  )
  handle(
    'photos:write',
    (
      _event,
      playthroughId: string,
      photoId: string,
      image: string,
      thumb: string,
      meta: PhotoMeta
    ) => writePhoto(playthroughId, photoId, image, thumb, meta)
  )
  handle('photos:writeThumb', (_event, playthroughId: string, photoId: string, thumb: string) =>
    writePhotoThumb(playthroughId, photoId, thumb)
  )
  handle('photos:delete', (_event, playthroughId: string, photoId: string) =>
    deletePhoto(playthroughId, photoId)
  )
  // A copy of the photo, saved where the native dialog points; a dismissed dialog resolves `null`.
  handle('photos:export', async (event, playthroughId: string, photoId: string) => {
    const bytes = await readPhoto(playthroughId, photoId)
    if (bytes === null) {
      throw appError(
        'PHOTO_UNEXPORTABLE',
        'Could not save the photo.',
        'No picture is stored for that photo.'
      )
    }
    const name = photoExportName(photoId, bytes)
    const extension = name.slice(name.lastIndexOf('.') + 1)
    const { canceled, filePath } = await showSaveDialogFor(event, {
      title: 'Save photo',
      defaultPath: name,
      filters: [{ name: `${extension.toUpperCase()} image`, extensions: [extension] }]
    })
    if (canceled || filePath === undefined || filePath === '') return null

    await copyPhotoTo(playthroughId, photoId, filePath)
    return filePath
  })

  handle('comfy:start', () => startComfy())
  handle('comfy:stop', () => stopComfyByHand())

  // `staged` renders into the character's staging tree instead of over the live set.
  handle(
    'comfy:generateExpression',
    (
      _event,
      character: Character,
      emotion: Emotion,
      seed?: number,
      staged?: boolean,
      edit?: PromptEdit
    ) =>
      enqueueComfyJob(character, emotion, (options) =>
        generateSprite(character, null, emotion, seed, staged, edit, options)
      )
  )

  // One job per CG; `cg:` keeps the key out of the emotion namespace.
  handle(
    'comfy:generateCg',
    (
      _event,
      character: Character,
      position: Position,
      seed?: number,
      staged?: boolean,
      edit?: PromptEdit
    ) =>
      enqueueComfyJob(character, `cg:${position}`, (options) =>
        generateCg(character, position, seed, staged, edit, options)
      )
  )

  // One job per image; `outfit:` keeps the key out of the emotion and `cg:` namespaces.
  handle(
    'comfy:generateOutfit',
    (
      _event,
      character: Character,
      set: OutfitSet,
      emotion: Emotion,
      seed?: number,
      staged?: boolean,
      edit?: PromptEdit
    ) =>
      enqueueComfyJob(character, `outfit:${set}:${emotion}`, (options) =>
        generateSprite(character, set, emotion, seed, staged, edit, options)
      )
  )

  /*
   * The hand repair's render, queued and cancellable like the sprite jobs and gated
   * by the same `assertEditableChar`. It answers with bytes rather than a path: what it renders
   * belongs to no file until the player has looked at it and said yes.
   */
  handle(
    'comfy:fixHands',
    (
      _event,
      character: Character,
      target: WardrobeTarget,
      paintLayer: string,
      seed: number
    ) => {
      // Decoded before the queue, so bytes that are not a PNG fail now rather than an hour in.
      const paint = decodePng(paintLayer, 'the paint layer')
      return enqueueComfyJob(character, `hands:${target}`, (options) =>
        fixHands(character, target === 'default' ? null : target, paint, seed, options)
      )
    }
  )

  handle('jobs:cancelGroup', (_event, group: string) => cancelGroup(group))

  // The per-set axis: cancels one set's keys without touching the character's other work.
  handle('jobs:cancelKeys', (_event, group: string, keys: string[]) => cancelKeys(group, keys))

  // Unqueued; `group` lets character deletion abort it.
  handle('llm:generateCharacter', (_event, request: StructuredRequest, group: string) =>
    runAbortable(group, (signal) => completeStructured(request, signal))
  )

  // The scene classifier call: structured, unstreamed.
  handle(
    'llm:classify',
    (_event, request: ClassifierPromptRequest, charKeys: string[], group: string) =>
      runAbortable(group, (signal) => classifyCloud(request, charKeys, signal))
  )

  // The one-shot class-catalog call; `group` is the New Game start's.
  handle('llm:generateClasses', (_event, request: StructuredRequest, group: string) =>
    runAbortable(group, (signal) => completeStructured(request, signal))
  )

  // The student-profile call, the second of New Game's one-shots, on the same terms.
  handle('llm:generateProfiles', (_event, request: StructuredRequest, group: string) =>
    runAbortable(group, (signal) => completeStructured(request, signal))
  )

  // The third one-shot New Game call, on the same terms.
  handle('llm:generateOccasions', (_event, request: StructuredRequest, group: string) =>
    runAbortable(group, (signal) => completeStructured(request, signal))
  )

  // The fourth, sent only when a semester is continued from the one before it.
  handle('llm:generateBreak', (_event, request: StructuredRequest, group: string) =>
    runAbortable(group, (signal) => completeStructured(request, signal))
  )

  // The exam-question call: structured, unstreamed, no group.
  handle('llm:generateQuiz', (_event, request: StructuredRequest) => completeStructured(request))

  // The model ids a custom endpoint lists, falling back to the stored key for that origin.
  handle('llm:listModels', async (_event, endpointUrl: string, apiKey?: string) => {
    const stored = await getSettings()
    return listModels({ endpointUrl, apiKey: apiKey ?? storedEndpointKeyFor(stored, endpointUrl) })
  })

  // One tiny structured request on the form's own writer fields; the error is the answer.
  handle('llm:testWriter', async (_event, candidate: WriterCandidate) => {
    const stored = await getSettings()
    await testWriter({
      ...stored,
      ...candidate,
      endpointApiKey:
        candidate.endpointApiKey ?? storedEndpointKeyFor(stored, candidate.endpointUrl ?? '')
    })
  })

  // The image models the form's own images URL lists, on the key a picture there would take.
  handle('llm:listImageModels', async (_event, candidate: ImageEndpointCandidate) =>
    listImageModels(await getSettings(), candidate)
  )

  // One picture on the form's own image fields; the error is the answer.
  handle('llm:testImages', async (_event, candidate: ImageCandidate) =>
    testImages(await getSettings(), candidate)
  )

  handle('chars:list', () => listCharacters())
  handle(
    'chars:create',
    (
      _event,
      firstName: string,
      lastName: string,
      brief?: CharacterBrief,
      reference?: ReferenceImage
    ) => createCharacter(firstName, lastName, brief, reference)
  )
  // The picture her brief was submitted with, for a resumed write.
  handle('chars:reference', (_event, charId: string) => readReference(charId))
  handle('chars:update', (_event, character: Character) => writeCharacter(character))
  handle('chars:delete', (_event, charId: string) => deleteCharacter(charId))
  handle('chars:expressions', (_event, charId: string) => getExpressionStatus(charId))
  handle('chars:cgs', (_event, charId: string) => getCgStatus(charId))
  handle('chars:outfits', (_event, charId: string) => getOutfitStatus(charId))
  // Whether a set's base frame exists; a fill asks before minting one.
  handle('chars:hasBase', (_event, charId: string, target: SetTarget) =>
    hasBaseImage(charId, target)
  )
  // The two ends of a staged regenerate: commit or discard.
  handle('chars:commitStaged', (_event, charId: string, target: SetTarget) =>
    commitStagedSet(charId, target)
  )
  handle('chars:discardStaged', (_event, charId: string, target?: SetTarget) =>
    discardStaged(charId, target)
  )
  // One custom wardrobe's images, live and staged; the renderer rewrites the record itself.
  handle('chars:deleteSet', (_event, charId: string, slot: CustomOutfitSlot) =>
    deleteCustomSet(charId, slot)
  )
  // Bytes for the repair editors; a view that only shows an image uses `charimg://`.
  handle(
    'chars:readWardrobeImage',
    (_event, charId: string, target: WardrobeTarget, image: string) =>
      readWardrobeImage(charId, target, image)
  )
  // Bytes for the picture a manual save carries of the stage.
  handle('chars:readImage', (_event, charId: string, rel: string) =>
    readCharacterImage(charId, rel)
  )
  // Unqueued: it writes files the renderer has already composed.
  handle(
    'chars:applyWardrobeFix',
    (
      _event,
      charId: string,
      target: WardrobeTarget,
      images: WardrobeFixImage[],
      paintLayer: string | null,
      kind: WardrobeLayer
    ) => applyWardrobeFix(charId, target, images, paintLayer, kind)
  )
  // The hand repair's own housekeeping: strokes outlive the hand they placed a finger on.
  handle(
    'chars:discardWardrobeLayer',
    (_event, charId: string, target: WardrobeTarget, kind: WardrobeLayer) =>
      discardWardrobeLayer(charId, target, kind)
  )
  // The portrait's two ends: main cuts the PNG, so no pixels cross the bridge.
  handle('chars:profileCrop', (_event, charId: string) => getProfileCrop(charId))
  handle('chars:setProfileCrop', (_event, charId: string, crop: ProfileCrop) =>
    setProfileCrop(charId, crop)
  )
  // The two dialog-backed transfer channels; a dismissed dialog resolves `null`.
  handle('chars:export', async (event, charId: string) => {
    const character = await getCharacter(charId)
    const { canceled, filePath } = await showSaveDialogFor(event, {
      title: 'Export character',
      defaultPath: exportFileName(character),
      filters: [{ name: 'Zip archive', extensions: ['zip'] }]
    })
    if (canceled || filePath === undefined || filePath === '') return null

    await exportCharacter(charId, filePath)
    return filePath
  })
  handle('chars:import', async (event) => {
    const { canceled, filePaths } = await showOpenDialogFor(event, {
      title: 'Import character ZIP',
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null

    return importCharacter(filePaths[0])
  })
  // The third transfer channel, with no dialog.
  handle('chars:duplicate', (_event, charId: string) => duplicateCharacter(charId))
  // The fourth: a SillyTavern card or sprite pack the renderer already composed, saved where
  // the native dialog points; a dismissed dialog resolves `null`.
  handle('chars:saveExport', async (event, kind: ExportKind, name: string, base64: string) => {
    const { canceled, filePath } = await showSaveDialogFor(event, {
      title: kind === 'card' ? 'Export SillyTavern card' : 'Export SillyTavern sprites',
      defaultPath: name,
      filters:
        kind === 'card'
          ? [{ name: 'PNG image', extensions: ['png'] }]
          : [{ name: 'Zip archive', extensions: ['zip'] }]
    })
    if (canceled || filePath === undefined || filePath === '') return null

    await saveExportFile(kind, filePath, base64)
    return filePath
  })

  // Everything the app keeps, as one zip saved where the native dialog points; a dismissed
  // dialog resolves `null`.
  handle('backup:export', async (event) => {
    const { canceled, filePath } = await showSaveDialogFor(event, {
      title: 'Back up game data',
      defaultPath: backupName(),
      filters: [{ name: 'Zip archive', extensions: ['zip'] }]
    })
    if (canceled || filePath === undefined || filePath === '') return null

    await exportBackup(filePath)
    await exportLocalPhotos(filePath)
    return filePath
  })
  // A backup read back over everything here; a dismissed dialog resolves `false`.
  handle('backup:import', async (event) => {
    const { canceled, filePaths } = await showOpenDialogFor(event, {
      title: 'Restore from backup',
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return false

    await importBackup(filePaths[0])
    await importLocalPhotos(filePaths[0])
    return true
  })

  // The backgrounds the player brought: kept install-wide beside the characters.
  handle('backgrounds:list', () => listCustomBackgrounds())
  handle('backgrounds:add', (_event, draft: unknown, images: unknown) =>
    addCustomBackground(draft, images)
  )
  handle('backgrounds:remove', (_event, name: unknown) => removeCustomBackground(name))
  handle('backgrounds:readImage', (_event, name: unknown, variant: unknown) =>
    readCustomBackgroundImage(name, variant)
  )

  // The shipped cast and which of them the player has taken off the roster.
  handle('chars:defaults', () => getDefaultsStatus())
  handle('chars:restoreDefaults', () => restoreDefaults())
  // Every `shell.openPath` goes through `openFolder`.
  handle('chars:openFolder', async (_event, charId: string) => {
    assertSafeCharId(charId)
    await openFolder(getCharacterPath(charId), 'Could not open the character folder.')
  })
  handle('chars:room', (_event, charId: string) => getRoomStatus(charId))
  // A cloud render: plain `enqueue` under the charId group, never `enqueueComfyJob`.
  handle(
    'chars:generateRoom',
    async (_event, character: Character, variant: RoomVariant, staged?: boolean) => {
      // The cloud bucket's own copy of `enqueueComfyJob`'s gate.
      await assertEditableChar(character.charId)
      return enqueue({
        group: character.charId,
        key: `room:${variant}`,
        run: async ({ signal, report }) => {
          report('Rendering room')
          await generateRoomImage(character, variant, staged, signal)
          return `room:${variant}`
        }
      })
    }
  )
  // A picture the player picked, already cut and encoded by the renderer.
  handle(
    'chars:uploadRoom',
    async (_event, charId: string, variant: RoomVariant, png: string) => {
      await assertEditableChar(charId)
      await writeRoomUpload(charId, variant, png)
    }
  )

  // Progress goes out on a fixed push channel; the invoke returns only the final result.
  handle('setup:runInstall', async (event) => {
    const jobId = randomUUID()
    const result = await runInstall(jobId, (progress: InstallProgress) => {
      if (event.sender.isDestroyed()) return
      event.sender.send('setup:installProgress', redactedProgress(progress))
    })
    return {
      ...result,
      errors: result.errors.map((failure) => ({ ...failure, error: redactError(failure.error) }))
    }
  })

  // The manual-placement pair; `setup:verifyModel` reports on the install's push channel.
  handle('setup:openModelFolder', async (_event, componentId: string) => {
    await openFolder(await getModelFolder(componentId), 'Could not open the models folder.')
  })
  handle('setup:verifyModel', (event, componentId: string) => {
    const jobId = randomUUID()
    return verifyModel(componentId, (step, percent, bytes) => {
      if (event.sender.isDestroyed()) return
      const progress: InstallProgress = {
        jobId,
        componentId,
        step,
        percent,
        bytesDone: bytes?.done,
        bytesTotal: bytes?.total
      }
      event.sender.send('setup:installProgress', redactedProgress(progress))
    })
  })
}

/** Reveals a folder, turning `shell.openPath`'s resolved message into a throw. */
async function openFolder(path: string, message: string): Promise<void> {
  const failure = await shell.openPath(path)
  if (failure !== '') throw appError('OPEN_FOLDER_FAILED', message, failure)
}

async function completeStructured<T>(request: StructuredRequest, ...args: Parameters<typeof completeCloudStructured<T>> extends [unknown, ...infer R] ? R : never): Promise<T> {
  return completeCloudStructured<T>(await prepareStoryRequest(request), ...args)
}
