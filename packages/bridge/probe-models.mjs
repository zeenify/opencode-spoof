import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/service"
const endpoint = await Service.ensure()
const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
const out = await client.model.list()
console.log(JSON.stringify(out).slice(0, 3000))
