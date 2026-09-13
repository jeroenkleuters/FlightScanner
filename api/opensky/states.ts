import { notFound, router } from '../_router.ts'

export default function handler(request: Request): Promise<Response> | Response {
  return router.handle(request) ?? notFound()
}
