import type { MeanwhileScene } from '@shared/meanwhile'
import type { ClassEntry } from '@shared/types'
import { bgUrl } from './bgAssets'

/** Timetable location IDs are not background filenames. Keep that translation explicit. */
const BACKGROUNDS: Readonly<Record<string, string>> = {
  agora: 'cafeteria', apogee_club: 'club', bobbys_diner: 'restaurant', btb_arcade: 'arcade',
  cutetea: 'cute_tea', eastern_buffet: 'asian_food', fast_eats: 'fast_food', freights_books: 'bookstore',
  green_hill_park: 'park', kendall_library: 'library', lowrise_dorms: 'dorm_lounge',
  elysium_village: 'elysium_living_room', lumiere_fusion: 'fine_dining', palaestra_stadium: 'stadium',
  pino_cola_lounge: 'pinocola_lounge', reserve_bank_cafe: 'reserve_cafe', spring_mart: 'supermarket',
  stalestein_bar: 'bar', thorne_auditorium: 'auditorium', venus_quad: 'quad', whitman_greenhouse: 'greenhouse',
  future_cinema: 'theater', hotel_dreams: 'love_hotel', lotterdale_market: 'market', pastel_palace: 'bakery',
  pier_44: 'theme_park', riverside_aquarium: 'aquarium', riverside_mall: 'mall', selkie_beach: 'beach',
  veridan_museum: 'museum',
  room: 'lowrise_dorm_room'
}

type EncounterPlace = Pick<MeanwhileScene, 'kind' | 'ref'> & Partial<Pick<MeanwhileScene, 'where'>>
type CoursePlace = Pick<ClassEntry, 'name' | 'category'>

/** Cached encounters keep their course title; a later semester may reuse the same course code. */
function coursePlace(scene: EncounterPlace, course?: CoursePlace): { name: string; pe: boolean } {
  const title = scene.where?.trim()
  const sameCourse = course && (!title || title === course.name.trim()) ? course : undefined
  const name = title || sameCourse?.name || ''
  const physical = /\b(climbing|bouldering|belaying|pilates|yoga|swimming|aquatics|water polo|basketball|volleyball|badminton|soccer|tennis|running|jogging|track and field|weightlifting|strength training|fitness|aerobics|bowling|roller skating)\b/i.test(name)
  return { name, pe: sameCourse ? sameCourse.category === 'pe' : physical }
}

/** Generated class names identify the activity, while the course category keeps PE out of classrooms. */
export function meanwhileBackgroundKey(scene: EncounterPlace, course?: CoursePlace): string {
  if (scene.kind === 'class') {
    const { name, pe } = coursePlace(scene, course)
    if (pe) {
      if (/\bbowling\b/i.test(name)) return 'bowling_alley'
      if (/\broller[ -]?(skating|blading|derby)\b/i.test(name)) return 'roller_rink'
      if (/\b(swim\w*|aquatics|water polo|diving)\b/i.test(name)) return 'pool'
      if (/\b(weight[ -]?lifting|strength training|resistance training|powerlifting)\b/i.test(name)) return 'weight_room'
      if (/\b(running|jogging|sprinting|track and field|marathon)\b/i.test(name)) return 'track'
      if (/\b(soccer|tennis|archery|outdoor fitness)\b/i.test(name)) return 'outdoor_fitness'
      return 'gymnasium'
    }
    // Match practical subjects, not broad majors such as the history of art or food science.
    if (/\b(cooking|baking|culinary|pastry)\b/i.test(name)) return 'kitchen'
    if (/\b(painting|drawing|sculpture|ceramics|printmaking)\b/i.test(name) && !/\b(history|theory|criticism)\b/i.test(name)) return 'art_studio'
    if (/\b(piano|guitar|vocal|singing|choir|instrumental|music performance)\b/i.test(name)) return 'music_practice'
    if (/\b(lab|laboratory)\b/i.test(name)) return 'lab'
    return 'classroom'
  }
  if (scene.kind === 'dorm') return 'dorm_lounge'
  return BACKGROUNDS[scene.ref] ?? scene.ref
}

/** Native encounters have no time/weather stamp, so use a neutral day illustration. */
export function meanwhileBackgroundUrl(scene: EncounterPlace, course?: CoursePlace): string | null {
  const key = meanwhileBackgroundKey(scene, course)
  const url = bgUrl(key, 'day', false)
  if (url || scene.kind !== 'class') return url
  // Optional venue art may be absent; retain the appropriate native classroom/gym fallback.
  const fallback = coursePlace(scene, course).pe ? 'gymnasium' : 'classroom'
  return key === fallback ? null : bgUrl(fallback, 'day', false)
}
