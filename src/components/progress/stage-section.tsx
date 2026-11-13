import { Check } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { formatDate } from "@/lib/dates";
import type { StageProgress } from "@/server/stages/queries";
import { PhotoGallery } from "./photo-gallery";

/**
 * "භෞතික ප්‍රගතිය" as in the prototype: each stage with the day it was reached, its note and photo
 * thumbnails (STG-6), the next stage marked, and the visits that added only a note. A kind that follows
 * no stage list (`LAND_ONLY`, `LAND_WITH_HOUSE`) says so, and takes notes only (STG-4). `update` is the
 * DS office's button to record progress (STG-1).
 */
export async function StageSection({ progress, update }: { progress: StageProgress; update?: React.ReactNode }) {
  const t = await getTranslations("progress.stages");
  const nextId = progress.choices[0]?.id ?? null;
  const allDone = progress.stages.length > 0 && progress.choices.length === 0;

  return (
    <section aria-labelledby="stages-title" className="flex flex-col gap-3 rounded-xl border bg-card px-5.5 py-5">
      <h2 id="stages-title" className="text-xl font-bold">
        {t("title")}
      </h2>
      {progress.stages.length > 0 && (
        <ol className="flex flex-col">
          {progress.stages.map((stage, index) => {
            const done = stage.reachedOn !== null;
            const isNext = stage.id === nextId;
            return (
              <li key={stage.id} className="flex items-start gap-3.5 py-2">
                <span
                  aria-hidden="true"
                  className={`flex size-8.5 shrink-0 items-center justify-center rounded-full border-2 text-[15px] font-bold ${
                    done
                      ? "border-primary bg-primary text-primary-foreground"
                      : isNext
                        ? "border-primary bg-card text-[#4F5752]"
                        : "border-[#B9B4A8] bg-card text-[#4F5752]"
                  }`}
                >
                  {done ? <Check className="size-4.5" strokeWidth={3} /> : index + 1}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className={`text-[17px] ${done || isNext ? "font-bold" : "font-medium"}`}>{stage.name}</span>
                  {stage.reachedOn && (
                    <span className="text-[15px] text-[#4F5752]">
                      {t("reachedOn", { date: formatDate(stage.reachedOn) })}
                    </span>
                  )}
                  {isNext && <span className="text-[15px] text-[#4F5752]">{t("next")}</span>}
                  {stage.inactive && <span className="text-sm text-muted-foreground">{t("inactive")}</span>}
                  {stage.note && <span className="text-[15px] whitespace-pre-line">{stage.note}</span>}
                  {stage.photos.length > 0 && <PhotoGallery photos={stage.photos} label={stage.name} />}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {allDone && <p className="font-semibold text-primary">{t("allDone")}</p>}
      {!progress.hasStageList && <p className="text-[15px] text-[#4F5752]">{t("noStageList")}</p>}

      {progress.visits.length > 0 && (
        <div className="flex flex-col gap-2 border-t pt-3">
          <h3 className="text-base font-bold">{t("visits")}</h3>
          <ul className="flex flex-col gap-2.5">
            {progress.visits.map((visit) => {
              const label = t("visitOn", { date: formatDate(visit.visitedOn) });
              return (
                <li key={visit.id} className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-semibold">{label}</span>
                  {visit.note && <span className="text-[15px] whitespace-pre-line">{visit.note}</span>}
                  {visit.photos.length > 0 && <PhotoGallery photos={visit.photos} label={label} />}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {update}
    </section>
  );
}
