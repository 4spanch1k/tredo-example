import { handleCronJob } from "../_shared/job_handler.ts";
import { runItNewsRadar } from "./job.ts";

Deno.serve((request) => handleCronJob(request, "it-news-radar", runItNewsRadar));
