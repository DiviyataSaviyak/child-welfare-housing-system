"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { FormError, FormField, FormTextArea } from "@/components/forms/form-field";
import { Modal } from "@/components/modal";
import { colomboDay, formatDate, parseDay } from "@/lib/dates";
import { isValidNic, normaliseNic } from "@/lib/nic";
import {
  AIDS,
  ageOn,
  CARE_GROUPS,
  CASE_FIELDS,
  CATEGORIES,
  type CaseErrorField,
  type CaseErrors,
  type CaseField,
  type CaseFormValues,
  CENTRE_FIELDS,
  CENTRE_PARTS,
  type CentreFormValues,
  type CentrePart,
  centreError,
  centreInput,
  formatPartialDate,
  formReader,
  KINDS,
  type KindValue,
  MARITAL_STATUSES,
  MAX_CENTRES,
  parseCaseForm,
  parseOfficeId,
  RELATIONSHIPS,
} from "@/lib/validation/case";
import type { CaseCommandError } from "@/server/cases/commands";
import type { NicMatch } from "@/server/cases/duplicates";
import type { DistrictOptions } from "@/server/lists/queries";
import { CaseDocuments, type DocumentActions, type Upload } from "./case-documents";
import { NicMatches } from "./nic-matches";

export type { CaseFormValues, CentreFormValues };
export type CaseFormState = { errors: CaseErrors; error: CaseCommandError | null };

/** The form's starting values: every field, and the centres (at least one box). */
export type CaseFormStart = { values: CaseFormValues; centres: CentreFormValues[] };

/** Where the beneficiary lives: the DS office of residence, which enters the case (CASE-3). */
export type OfficeSetting =
  /** A DS officer's own office, from their account. */
  | { kind: "own"; dsOfficeId: number; provinceName: string; districtName: string; officeName: string }
  /** The Ministry, once the case is allocated: the office stays. */
  | { kind: "fixed"; dsOfficeId: number; provinceName: string; districtName: string; officeName: string }
  /** The Ministry chooses the district, then the DS office; the province follows the district. */
  | { kind: "choose"; districts: DistrictOptions[]; districtId: number | null; dsOfficeId: number | null };

/** CASE-13, CASE-17: where the land is (the house, for a renovation). */
export type BuildSetting =
  /** Asked on the form; `dsOfficeId` is another DS office, or null for the DS of residence. */
  | { kind: "choose"; districts: DistrictOptions[]; districtId: number | null; dsOfficeId: number | null }
  /** Once the case is allocated, it stays; `dsOfficeId` is null for the DS of residence. */
  | { kind: "fixed"; dsOfficeId: number | null; districtName: string; officeName: string };

export type CaseFormActions = DocumentActions & {
  save: (state: CaseFormState, form: FormData) => Promise<CaseFormState>;
  checkNic: (nic: string, caseId: string, dsOfficeId: number | null) => Promise<NicMatch[]>;
};

type Built = "same" | "other";
type Place = { province: string; district: string; office: string };

const EMPTY: CaseFormState = { errors: {}, error: null };
export const EMPTY_CENTRE: CentreFormValues = Object.fromEntries(
  CENTRE_FIELDS.map((field) => [field, ""]),
) as CentreFormValues;
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1));

/** The beneficiary's details in the order part 3 shows them, for each category (CASE-14, CASE-15). */
const DETAILS: Record<"CARE_LEAVER" | "CHILD_AT_RISK" | "none", CaseField[]> = {
  CARE_LEAVER: [
    "applicationNumber",
    "name",
    "dateOfBirth",
    "nic",
    "maritalStatus",
    "address",
    "gnDivision",
    "mobile1",
    "mobile2",
  ],
  CHILD_AT_RISK: [
    "applicationNumber",
    "childName",
    "dateOfBirth",
    "name",
    "relationship",
    "relationshipOther",
    "nic",
    "address",
    "gnDivision",
    "mobile1",
    "mobile2",
  ],
  none: ["applicationNumber", "name", "dateOfBirth", "nic", "address", "gnDivision", "mobile1", "mobile2"],
};
const FAMILY: CaseField[] = ["familyMembers", "disabledChildren", "aid", "aidOther"];

/** Where an error's link goes: the field, or the group of choices it belongs to. */
const TARGET: Partial<Record<CaseField, string>> = {
  category: "part-category",
  careGroup: "careGroup",
  kind: "part-kind",
  maritalStatus: "maritalStatus",
  relationship: "relationship",
  disabledChildren: "disabledChildren",
  aid: "aid",
};
const centreTarget = (index: number, part: CentrePart) =>
  `centre-${index}-${part === "from" ? "fromYear" : part === "until" ? "untilYear" : part}`;

/**
 * CASE-1: the case form on one page, in five numbered parts: the category, the kind of help and the land,
 * the beneficiary's details, the family and the aid received, and other documents. Everything typed is
 * kept in state, so a refused save loses nothing (ERR-1, ERR-3). The browser runs the same checks as the
 * server before anything is sent, and asks only what belongs to the chosen category (CASE-14, CASE-15).
 * There are no drafts: every save needs every required field, and a new case shows a summary to confirm
 * first, then goes straight to "awaiting fund allocation" (CASE-5). The kind of help is followed by where
 * the land is (CASE-13, CASE-17); the province, district and DS of residence open the beneficiary's details
 * (CASE-3). A saved case is changed with one save button (CASE-9); `intro` says that every change is
 * logged, for the Ministry's changes after the allocation. `kinds` are the kinds it may have: after the
 * District's release, only those of its own group (CASE-9, `kindsOffered`).
 */
export function CaseForm({
  caseId,
  version,
  initial,
  office,
  build,
  provinces,
  documents,
  actions,
  mode,
  intro = false,
  kinds = KINDS,
}: {
  caseId: string;
  /** The version the form was opened with (CASE-10); null for a new case. */
  version: number | null;
  initial: CaseFormStart;
  office: OfficeSetting;
  build: BuildSetting;
  /** The nine provinces, for the centres (CASE-14). */
  provinces: { id: number; name: string }[];
  documents: { id: string; name: string }[];
  actions: CaseFormActions;
  mode: "new" | "edit";
  intro?: boolean;
  kinds?: readonly KindValue[];
}) {
  const t = useTranslations("cases");
  const [state, dispatch, pending] = useActionState(actions.save, EMPTY);
  const [, startTransition] = useTransition();
  const [values, setValues] = useState(initial.values);
  const [centres, setCentres] = useState(initial.centres.length > 0 ? initial.centres : [EMPTY_CENTRE]);
  const [districtId, setDistrictId] = useState(office.kind === "choose" ? String(office.districtId ?? "") : "");
  const [dsOfficeId, setDsOfficeId] = useState(office.kind === "choose" ? String(office.dsOfficeId ?? "") : "");
  const [built, setBuilt] = useState<Built>(build.dsOfficeId === null ? "same" : "other");
  const [buildDistrictId, setBuildDistrictId] = useState(build.kind === "choose" ? String(build.districtId ?? "") : "");
  const [buildOfficeId, setBuildOfficeId] = useState(build.kind === "choose" ? String(build.dsOfficeId ?? "") : "");
  const [uploads, setUploads] = useState<Upload[]>([]);
  // Checks made in the browser; null once the form has gone to the server, whose answer then shows.
  const [localErrors, setLocalErrors] = useState<CaseErrors | null>(null);
  const [officeMissing, setOfficeMissing] = useState(false);
  const [buildMissing, setBuildMissing] = useState(false);
  const [failedTries, setFailedTries] = useState(0);
  const [nicCheck, setNicCheck] = useState<{ nic: string; matches: NicMatch[] } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const summary = useRef<HTMLDivElement>(null);

  // After a refused try, move to the list of errors so it is seen and read out.
  useEffect(() => {
    if (failedTries > 0) summary.current?.focus();
  }, [failedTries]);

  const today = colomboDay(new Date());
  const category = CATEGORIES.find((c) => c === values.category);
  const kind = KINDS.find((k) => k === values.kind);
  const atRisk = category === "CHILD_AT_RISK";
  const careLeaver = category === "CARE_LEAVER";
  const ticked = new Set(values.aid.split(",").filter((aid) => aid !== ""));
  const errors = localErrors ?? state.errors;
  const serverError = localErrors === null ? state.error : null;
  const showOfficeError = officeMissing || serverError === "officeRequired";
  const showBuildError = buildMissing || serverError === "buildOfficeRequired";
  const uploading = uploads.some((u) => u.state === "uploading");
  const documentCount = documents.length + uploads.filter((u) => u.state === "done").length;
  const chosenOffice = office.kind === "choose" ? parseOfficeId(dsOfficeId) : null;
  // The DS of residence, which "the same DS division" means and the land's office can't be (CASE-13).
  const residence = office.kind === "choose" ? chosenOffice : office.dsOfficeId;
  const chosenBuildOffice = build.kind === "choose" && built === "other" ? parseOfficeId(buildOfficeId) : null;
  const read = formReader(values, centres);

  const setField = (field: CaseField, value: string) => setValues((current) => ({ ...current, [field]: value }));
  const set = (field: CaseField) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setField(field, event.target.value);
  const toggleAid = (aid: string, on: boolean) => {
    const next = new Set(ticked);
    if (on) next.add(aid);
    else next.delete(aid);
    setField("aid", AIDS.filter((a) => next.has(a)).join(","));
  };

  const fieldLabel = (field: CaseField) => {
    if (field === "name" && atRisk) return t("page.fields.guardianName");
    if (field === "relationshipOther") return t("page.fields.relationship");
    if (field === "aidOther") return t("page.fields.aid");
    if (field === "dateOfBirth" && atRisk) return t("page.fields.childDateOfBirth");
    return t(`page.fields.${field}`);
  };
  const errorText = (field: CaseErrorField) => {
    const key = errors[field];
    return key ? t(`form.errors.${key}`) : undefined;
  };

  /** CASE-6: other cases with this NIC, as the server lets this viewer see them. Never blocks anything. */
  async function lookUp(raw: string): Promise<NicMatch[]> {
    const nic = normaliseNic(raw);
    if (!isValidNic(nic)) return [];
    try {
      const matches = await actions.checkNic(nic, caseId, chosenOffice);
      setNicCheck({ nic, matches });
      return matches;
    } catch {
      return [];
    }
  }
  const matches = nicCheck && nicCheck.nic === normaliseNic(values.nic) ? nicCheck.matches : [];

  function send() {
    const form = new FormData();
    form.set("id", caseId);
    form.set("version", version === null ? "" : String(version));
    for (const field of CASE_FIELDS) form.set(field, values[field]);
    centres.forEach((centre, index) => {
      for (const field of CENTRE_FIELDS) form.set(centreInput(index, field), centre[field]);
    });
    if (office.kind === "choose") form.set("dsOfficeId", dsOfficeId);
    if (build.kind === "choose") {
      form.set("built", built);
      if (built === "other") form.set("buildDsOfficeId", buildOfficeId);
    } else if (build.dsOfficeId !== null) {
      form.set("built", "other");
      form.set("buildDsOfficeId", String(build.dsOfficeId));
    } else {
      form.set("built", "same");
    }
    for (const upload of uploads) if (upload.state === "done" && upload.id) form.append("documentIds", upload.id);
    startTransition(() => dispatch(form));
  }

  async function attempt() {
    const checked = parseCaseForm(read, today);
    const noOffice = office.kind === "choose" && chosenOffice === null;
    const noBuild = build.kind === "choose" && built === "other" && chosenBuildOffice === null;
    if (!checked.ok || noOffice || noBuild) {
      setLocalErrors(checked.ok ? {} : checked.errors);
      setOfficeMissing(noOffice);
      setBuildMissing(noBuild);
      setFailedTries((n) => n + 1);
      return;
    }
    setLocalErrors(null);
    setOfficeMissing(false);
    setBuildMissing(false);
    // CASE-9: a change is saved at once; a new case is confirmed first (CASE-5).
    if (mode === "edit") {
      send();
      return;
    }
    await lookUp(values.nic);
    setConfirming(true);
  }

  // The list above the buttons (ERR-1), in the order of the form, each linked to its field.
  const fieldError = (field: CaseField) => {
    const key = errors[field];
    if (!key) return [];
    const text = t(`form.errors.${key}`);
    const message =
      key === "tooShort" || key === "tooLong"
        ? t("form.errors.inField", { field: fieldLabel(field), message: text })
        : text;
    return [{ key: field, target: TARGET[field] ?? field, message }];
  };
  const centreErrors = careLeaver
    ? [
        ...(errors.centres
          ? [{ key: "centres", target: "centre-0-name", message: t(`form.errors.${errors.centres}`) }]
          : []),
        ...centres.flatMap((_, index) =>
          CENTRE_PARTS.flatMap((part) => {
            const key = errors[centreError(index, part)];
            if (!key) return [];
            const text = t(`form.errors.${key}`);
            const inName =
              key === "tooShort" || key === "tooLong"
                ? t("form.errors.inField", { field: t("form.centreName"), message: text })
                : text;
            return [
              {
                key: centreError(index, part),
                target: centreTarget(index, part),
                message: t("form.errors.inCentre", { number: index + 1, message: inName }),
              },
            ];
          }),
        ),
      ]
    : [];
  const details = DETAILS[category ?? "none"];
  const errorList = [
    ...fieldError("category"),
    ...fieldError("careGroup"),
    ...fieldError("kind"),
    ...(showBuildError
      ? [{ key: "built", target: "buildDsOfficeId", message: t("form.errors.buildOfficeRequired") }]
      : []),
    ...fieldError("landGnDivision"),
    ...(showOfficeError ? [{ key: "office", target: "dsOfficeId", message: t("form.errors.officeRequired") }] : []),
    ...details.flatMap(fieldError),
    ...centreErrors,
    ...fieldError("remark"),
    ...FAMILY.flatMap(fieldError),
  ];

  const complete = parseCaseForm(read, today);
  const incomplete: CaseErrors = complete.ok ? {} : complete.errors;
  const officeChosen = office.kind !== "choose" || chosenOffice !== null;
  const buildChosen = build.kind !== "choose" || built === "same" || chosenBuildOffice !== null;
  const centresDone = Object.keys(incomplete).every((key) => !key.startsWith("centres"));
  const parts = [
    { key: "category", done: !incomplete.category && !incomplete.careGroup, optional: false },
    { key: "kind", done: !incomplete.kind && !incomplete.landGnDivision && buildChosen, optional: false },
    {
      key: "details",
      done: [...details, "remark" as const].every((f) => !incomplete[f]) && centresDone && officeChosen,
      optional: false,
    },
    { key: "family", done: FAMILY.every((f) => !incomplete[f]), optional: false },
    { key: "documents", done: documentCount > 0, optional: true },
  ] as const;

  const district = office.kind === "choose" ? office.districts.find((d) => String(d.id) === districtId) : undefined;
  const officeName =
    office.kind === "choose"
      ? (district?.offices.find((o) => String(o.id) === dsOfficeId)?.name ?? "")
      : office.officeName;
  // The place of residence, once known: "the same DS division" is this place (CASE-13, CASE-17).
  const residencePlace: Place | null =
    office.kind === "choose"
      ? district && officeName
        ? { province: district.provinceName, district: district.name, office: officeName }
        : null
      : { province: office.provinceName, district: office.districtName, office: office.officeName };
  const buildDistrict =
    build.kind === "choose" ? build.districts.find((d) => String(d.id) === buildDistrictId) : undefined;
  const buildOfficeName = buildDistrict?.offices.find((o) => String(o.id) === buildOfficeId)?.name ?? "";
  const landPlace: Place | null =
    built === "same"
      ? residencePlace
      : buildDistrict && buildOfficeName
        ? { province: buildDistrict.provinceName, district: buildDistrict.name, office: buildOfficeName }
        : null;
  const house = kind === "RENOVATION";
  const busy = pending || uploading;
  const birthDay = parseDay(values.dateOfBirth.trim());
  const age = birthDay && birthDay <= today ? ageOn(birthDay, today) : null;
  const placeText = (place: Place) => t("form.land.place", place);
  const choice = (key: "yes" | "no") => t(key);

  const centreLines = centres
    .map((centre) => {
      const province = provinces.find((p) => String(p.id) === centre.provinceId)?.name ?? "";
      const date = (y: string, m: string, d: string) =>
        y.trim() === ""
          ? ""
          : formatPartialDate({ year: Number(y), month: m ? Number(m) : null, day: d ? Number(d) : null });
      const from = date(centre.fromYear, centre.fromMonth, centre.fromDay);
      const until = date(centre.untilYear, centre.untilMonth, centre.untilDay);
      if (centre.name.trim() === "") return null;
      return from || until
        ? t("page.centreLine", { name: centre.name.trim(), province, dates: `${from} – ${until}`.trim() })
        : t("page.centreLineNoDates", { name: centre.name.trim(), province });
    })
    .filter((line) => line !== null);
  const aidText = [...ticked]
    .map((aid) =>
      aid === "OTHER"
        ? t("otherTyped", { label: t("aid.OTHER"), text: values.aidOther.trim() })
        : t(`aid.${aid as (typeof AIDS)[number]}`),
    )
    .join(", ");

  return (
    <div className="flex items-start gap-7">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void attempt();
        }}
        className="flex min-w-0 flex-1 flex-col gap-5"
      >
        {intro && (
          <p className="rounded-lg bg-[#E4EDF8] px-4 py-3 text-[15px] text-[#1E4E8C]">{t("form.changeIntro")}</p>
        )}

        <Part number={1} id="part-category" title={t("form.partCategory")}>
          <ChoiceCards
            name="category"
            labelledBy="part-category-title"
            options={CATEGORIES.map((value) => ({
              value,
              label: t(`category.${value}`),
              hint: t(`categoryHint.${value}`),
            }))}
            value={values.category}
            onChange={(value) => setField("category", value)}
            error={errorText("category")}
          />
          {careLeaver && (
            <div className="flex flex-col gap-3 border-t pt-4">
              <h3 id="careGroup-title" className="text-lg font-bold">
                {t("form.careGroup")}
              </h3>
              <ChoiceCards
                id="careGroup"
                name="careGroup"
                labelledBy="careGroup-title"
                options={CARE_GROUPS.map((value) => ({ value, label: t(`careGroup.${value}`) }))}
                value={values.careGroup}
                onChange={(value) => setField("careGroup", value)}
                error={errorText("careGroup")}
              />
            </div>
          )}
        </Part>

        <Part number={2} id="part-kind" title={t("form.partKind")}>
          <ChoiceCards
            name="kind"
            labelledBy="part-kind-title"
            options={kinds.map((value) => ({ value, label: t(`kind.${value}`), hint: t(`kindHint.${value}`) }))}
            value={values.kind}
            onChange={(value) => setField("kind", value)}
            error={errorText("kind")}
          />
          <div className="flex flex-col gap-3 border-t pt-4">
            <h3 id="built-title" className="text-lg font-bold">
              {house ? t("form.land.titleHouse") : t("form.land.title")}
            </h3>
            {build.kind === "choose" ? (
              <>
                <ChoiceCards
                  name="built"
                  labelledBy="built-title"
                  options={[
                    { value: "same", label: t("form.built.same"), hint: t("form.built.sameHint") },
                    { value: "other", label: t("form.built.other"), hint: t("form.built.otherHint") },
                  ]}
                  value={built}
                  onChange={(value) => {
                    setBuilt(value === "other" ? "other" : "same");
                    setBuildMissing(false);
                  }}
                />
                {built === "other" && (
                  <div className="grid grid-cols-2 gap-5 rounded-lg bg-muted p-4">
                    <Select
                      id="buildDistrictId"
                      label={t("form.built.district")}
                      value={buildDistrictId}
                      onChange={(value) => {
                        setBuildDistrictId(value);
                        setBuildOfficeId("");
                      }}
                      placeholder={t("form.choose")}
                      options={build.districts.map((d) => ({ value: String(d.id), label: d.name }))}
                    />
                    <Select
                      id="buildDsOfficeId"
                      label={t("form.built.office")}
                      value={buildOfficeId}
                      onChange={(value) => {
                        setBuildOfficeId(value);
                        setBuildMissing(false);
                      }}
                      placeholder={buildDistrict ? t("form.choose") : t("form.chooseDistrictFirst")}
                      disabled={!buildDistrict}
                      options={(buildDistrict?.offices ?? [])
                        .filter((o) => (o.active || o.id === build.dsOfficeId) && o.id !== residence)
                        .map((o) => ({ value: String(o.id), label: o.name }))}
                      error={showBuildError ? t("form.errors.buildOfficeRequired") : undefined}
                    />
                  </div>
                )}
                {landPlace && (
                  <p data-testid="land-place" className="text-[15px] text-[#3F4843]">
                    {placeText(landPlace)}
                  </p>
                )}
              </>
            ) : (
              <p className="rounded-lg bg-muted px-4 py-3 text-[15px] text-[#3F4843]">
                {build.dsOfficeId === null
                  ? t("form.built.fixedSame")
                  : t("form.built.fixed", { district: build.districtName, office: build.officeName })}
              </p>
            )}
            <div className="grid grid-cols-2 gap-5">
              <FormField
                id="landGnDivision"
                label={house ? t("form.land.gnDivisionHouse") : t("form.land.gnDivision")}
                value={values.landGnDivision}
                onChange={set("landGnDivision")}
                error={errorText("landGnDivision")}
              />
            </div>
          </div>
        </Part>

        <Part number={3} id="part-details" title={t("form.partDetails")}>
          {office.kind === "choose" ? (
            <div className="flex flex-col gap-3 rounded-lg bg-muted p-4">
              <div className="grid grid-cols-2 gap-5">
                <Select
                  id="districtId"
                  label={t("form.district")}
                  value={districtId}
                  onChange={(value) => {
                    setDistrictId(value);
                    setDsOfficeId("");
                  }}
                  placeholder={t("form.choose")}
                  options={office.districts.map((d) => ({ value: String(d.id), label: d.name }))}
                />
                <Select
                  id="dsOfficeId"
                  label={t("form.office")}
                  value={dsOfficeId}
                  onChange={setDsOfficeId}
                  placeholder={district ? t("form.choose") : t("form.chooseDistrictFirst")}
                  disabled={!district}
                  options={(district?.offices ?? [])
                    .filter((o) => o.active || o.id === office.dsOfficeId)
                    .map((o) => ({ value: String(o.id), label: o.name }))}
                  error={showOfficeError ? t("form.errors.officeRequired") : undefined}
                />
              </div>
              {district && (
                <p data-testid="residence-province" className="text-[15px] text-[#3F4843]">
                  {t("form.province", { province: district.provinceName })}
                </p>
              )}
            </div>
          ) : (
            <p data-testid="residence-place" className="rounded-lg bg-muted px-4 py-3 text-[15px] text-[#3F4843]">
              {t(office.kind === "own" ? "form.officeAuto" : "form.officeFixed", {
                province: office.provinceName,
                district: office.districtName,
                office: office.officeName,
              })}
            </p>
          )}

          <div className="grid grid-cols-2 gap-5">
            <FormField
              id="applicationNumber"
              label={t("form.applicationNumber")}
              help={t("form.applicationNumberHelp")}
              value={values.applicationNumber}
              onChange={set("applicationNumber")}
              autoComplete="off"
              error={errorText("applicationNumber")}
            />
          </div>
          {atRisk && (
            <div className="grid grid-cols-2 gap-5">
              <FormField
                id="childName"
                label={t("form.childName")}
                value={values.childName}
                onChange={set("childName")}
                error={errorText("childName")}
              />
              <BirthDate
                label={t("form.childDateOfBirth")}
                age={age === null ? null : t("form.age", { years: age })}
                value={values.dateOfBirth}
                today={today}
                onChange={set("dateOfBirth")}
                error={errorText("dateOfBirth")}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-5">
            <FormField
              id="name"
              label={atRisk ? t("form.guardianName") : t("form.name")}
              value={values.name}
              onChange={set("name")}
              error={errorText("name")}
            />
            {!atRisk && (
              <BirthDate
                label={t("form.dateOfBirth")}
                age={age === null ? null : t("form.age", { years: age })}
                value={values.dateOfBirth}
                today={today}
                onChange={set("dateOfBirth")}
                error={errorText("dateOfBirth")}
              />
            )}
          </div>
          {atRisk && (
            <div className="flex flex-col gap-3">
              <Radios
                id="relationship"
                label={t("form.relationship")}
                options={RELATIONSHIPS.map((value) => ({ value, label: t(`relationship.${value}`) }))}
                value={values.relationship}
                onChange={(value) => setField("relationship", value)}
                error={errorText("relationship")}
              />
              {values.relationship === "OTHER" && (
                <div className="grid grid-cols-2 gap-5">
                  <FormField
                    id="relationshipOther"
                    label={t("form.relationshipOther")}
                    help={t("form.relationshipOtherHelp")}
                    value={values.relationshipOther}
                    onChange={set("relationshipOther")}
                    error={errorText("relationshipOther")}
                  />
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-5">
            <FormField
              id="nic"
              label={atRisk ? t("form.guardianNic") : t("form.nic")}
              help={t("form.nicHelp")}
              value={values.nic}
              onChange={set("nic")}
              onBlur={() => void lookUp(values.nic)}
              autoComplete="off"
              error={errorText("nic")}
            />
          </div>
          {matches.length > 0 && <NicMatches matches={matches} />}
          {careLeaver && (
            <Radios
              id="maritalStatus"
              label={t("form.maritalStatus")}
              options={MARITAL_STATUSES.map((value) => ({ value, label: t(`maritalStatus.${value}`) }))}
              value={values.maritalStatus}
              onChange={(value) => setField("maritalStatus", value)}
              error={errorText("maritalStatus")}
            />
          )}
          <FormTextArea
            id="address"
            label={t("form.address")}
            value={values.address}
            onChange={set("address")}
            error={errorText("address")}
          />
          <div className="grid grid-cols-2 gap-5">
            <FormField
              id="gnDivision"
              label={t("form.gnDivision")}
              value={values.gnDivision}
              onChange={set("gnDivision")}
              error={errorText("gnDivision")}
            />
          </div>
          <div className="grid grid-cols-2 gap-5">
            <FormField
              id="mobile1"
              type="tel"
              label={t("form.mobile1")}
              value={values.mobile1}
              onChange={set("mobile1")}
              error={errorText("mobile1")}
            />
            <FormField
              id="mobile2"
              type="tel"
              label={t("form.mobile2")}
              value={values.mobile2}
              onChange={set("mobile2")}
              error={errorText("mobile2")}
            />
          </div>

          {careLeaver && (
            <fieldset aria-describedby="centres-help" className="flex flex-col gap-3 border-t pt-4">
              <legend className="pt-4 text-lg font-bold">{t("form.centres")}</legend>
              <p id="centres-help" className="text-[15px] text-muted-foreground">
                {t("form.centresHelp")}
              </p>
              {errors.centres && (
                <p id="centres-error" className="text-[15px] font-medium text-destructive">
                  {t(`form.errors.${errors.centres}`)}
                </p>
              )}
              {centres.map((centre, index) => (
                <CentreBox
                  // A box's place is its identity: the form shows them in order and names them by number.
                  key={index}
                  index={index}
                  value={centre}
                  provinces={provinces}
                  errorText={(part) => errorText(centreError(index, part))}
                  onChange={(next) => setCentres((all) => all.map((c, i) => (i === index ? next : c)))}
                  onRemove={index === 0 ? null : () => setCentres((all) => all.filter((_, i) => i !== index))}
                />
              ))}
              {centres.length < MAX_CENTRES && (
                <button
                  type="button"
                  onClick={() => setCentres((all) => [...all, EMPTY_CENTRE])}
                  className="h-11 self-start rounded-lg border border-primary px-5 font-semibold text-primary"
                >
                  {t("form.addCentre")}
                </button>
              )}
            </fieldset>
          )}

          <FormTextArea
            id="remark"
            label={t("form.remark")}
            value={values.remark}
            onChange={set("remark")}
            error={errorText("remark")}
          />
        </Part>

        <Part number={4} id="part-family" title={t("form.partFamily")}>
          <div className="grid grid-cols-2 gap-5">
            <FormField
              id="familyMembers"
              inputMode="numeric"
              label={t("form.familyMembers")}
              value={values.familyMembers}
              onChange={set("familyMembers")}
              error={errorText("familyMembers")}
            />
          </div>
          <Radios
            id="disabledChildren"
            label={t("form.disabledChildren")}
            options={(["yes", "no"] as const).map((value) => ({ value, label: choice(value) }))}
            value={values.disabledChildren}
            onChange={(value) => setField("disabledChildren", value)}
            error={errorText("disabledChildren")}
          />
          <fieldset id="aid" tabIndex={-1} aria-describedby="aid-help" className="flex flex-col gap-2.5">
            <legend className="text-base font-semibold">{t("form.aid")}</legend>
            <p id="aid-help" className="text-sm text-muted-foreground">
              {t("form.aidHelp")}
            </p>
            <div className="grid grid-cols-2 gap-x-5 gap-y-2.5">
              {AIDS.map((aid) => (
                <label key={aid} className="flex cursor-pointer items-center gap-3 text-[17px]">
                  <input
                    type="checkbox"
                    checked={ticked.has(aid)}
                    onChange={(event) => toggleAid(aid, event.target.checked)}
                    className="size-[22px] shrink-0 accent-primary"
                  />
                  {t(`aid.${aid}`)}
                </label>
              ))}
            </div>
          </fieldset>
          {ticked.has("OTHER") && (
            <div className="grid grid-cols-2 gap-5">
              <FormField
                id="aidOther"
                label={t("form.aidOther")}
                value={values.aidOther}
                onChange={set("aidOther")}
                error={errorText("aidOther")}
              />
            </div>
          )}
        </Part>

        <Part number={5} id="part-documents" title={t("form.partDocuments")}>
          <CaseDocuments
            caseId={caseId}
            saved={documents}
            uploads={uploads}
            onUploadsChange={setUploads}
            actions={actions}
          />
        </Part>

        {errorList.length > 0 && (
          <div
            ref={summary}
            id="case-errors"
            role="alert"
            tabIndex={-1}
            className="flex flex-col gap-1.5 rounded-lg border-2 border-destructive bg-destructive/5 px-5 py-4 text-[#8F1B12]"
          >
            <p className="text-[17px] font-bold">{t("form.errors.summary")}</p>
            <ul className="flex flex-col gap-1 text-[15px]">
              {errorList.map((item) => (
                <li key={item.key}>
                  <a href={`#${item.target}`} className="underline underline-offset-2">
                    {item.message}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {serverError && serverError !== "officeRequired" && serverError !== "buildOfficeRequired" && (
          <FormError id="case-error" message={t(`form.errors.${serverError}`)} />
        )}

        <div className="flex items-center justify-end gap-3">
          <button
            type="submit"
            disabled={busy}
            className="h-13 rounded-lg bg-primary px-7 text-[17px] font-bold text-primary-foreground disabled:opacity-60"
          >
            {pending ? t("form.saving") : mode === "edit" ? t("form.saveChanges") : t("form.save")}
          </button>
        </div>
      </form>

      <aside
        aria-labelledby="checklist-title"
        className="sticky top-20 flex w-[300px] shrink-0 flex-col gap-3.5 rounded-xl border bg-card p-5"
      >
        <h2 id="checklist-title" className="text-lg font-bold">
          {t("form.checklist.title")}
        </h2>
        <ol className="flex flex-col gap-3">
          {parts.map((part, index) => (
            <li key={part.key} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={`flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-[15px] font-bold ${
                  part.done
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-card text-muted-foreground"
                }`}
              >
                {index + 1}
              </span>
              <span className="flex flex-col">
                <span className="font-semibold">{t(`form.checklist.${part.key}`)}</span>
                <span className={`text-sm ${part.done ? "text-primary" : "text-muted-foreground"}`}>
                  {part.done
                    ? t(part.optional ? "form.checklist.attached" : "form.checklist.done")
                    : t(part.optional ? "form.checklist.optional" : "form.checklist.notDone")}
                </span>
              </span>
            </li>
          ))}
        </ol>
        <hr className="border-border" />
        <p className="text-[15px] text-[#3F4843]">{t("form.help")}</p>
      </aside>

      <Modal open={confirming} onClose={() => setConfirming(false)} labelledBy="confirm-title">
        <h2 id="confirm-title" className="text-[23px] font-bold">
          {t("form.confirm.title")}
        </h2>
        <p className="text-[#3F4843]">{t("form.confirm.text")}</p>
        <dl className="flex max-h-[55vh] flex-col overflow-y-auto rounded-lg border">
          {[
            { label: t("form.confirm.category"), value: category ? t(`category.${category}`) : "" },
            ...(careLeaver && complete.ok && complete.value.careGroup
              ? [{ label: t("form.confirm.careGroup"), value: t(`careGroup.${complete.value.careGroup}`) }]
              : []),
            { label: t("form.confirm.kind"), value: kind ? t(`kind.${kind}`) : "" },
            { label: t("form.confirm.land"), value: landPlace ? placeText(landPlace) : "" },
            { label: t("form.confirm.landGnDivision"), value: values.landGnDivision.trim() },
            { label: t("form.confirm.applicationNumber"), value: values.applicationNumber.trim() },
            ...(atRisk ? [{ label: t("form.confirm.childName"), value: values.childName }] : []),
            {
              label: t("form.confirm.dateOfBirth"),
              value: birthDay && age !== null ? t("page.dateWithAge", { date: formatDate(birthDay), years: age }) : "",
            },
            { label: atRisk ? t("form.confirm.guardianName") : t("form.confirm.name"), value: values.name },
            ...(atRisk && complete.ok && complete.value.relationship
              ? [
                  {
                    label: t("form.confirm.relationship"),
                    value:
                      complete.value.relationship === "OTHER"
                        ? t("otherTyped", {
                            label: t("relationship.OTHER"),
                            text: complete.value.relationshipOther ?? "",
                          })
                        : t(`relationship.${complete.value.relationship}`),
                  },
                ]
              : []),
            { label: t("form.confirm.nic"), value: normaliseNic(values.nic) },
            ...(careLeaver && complete.ok && complete.value.maritalStatus
              ? [{ label: t("form.confirm.maritalStatus"), value: t(`maritalStatus.${complete.value.maritalStatus}`) }]
              : []),
            { label: t("form.confirm.address"), value: values.address },
            { label: t("form.confirm.gnDivision"), value: values.gnDivision },
            {
              label: t("form.confirm.phones"),
              value: [values.mobile1, values.mobile2].filter((p) => p.trim() !== "").join(", "),
            },
            ...(careLeaver ? [{ label: t("form.confirm.centres"), value: centreLines.join("\n") }] : []),
            ...(residencePlace
              ? [
                  { label: t("form.confirm.province"), value: residencePlace.province },
                  { label: t("form.confirm.office"), value: `${residencePlace.office}, ${residencePlace.district}` },
                ]
              : []),
            { label: t("form.confirm.familyMembers"), value: values.familyMembers.trim() },
            {
              label: t("form.confirm.disabledChildren"),
              value:
                values.disabledChildren === "yes" || values.disabledChildren === "no"
                  ? choice(values.disabledChildren)
                  : "",
            },
            { label: t("form.confirm.aid"), value: aidText || t("page.noAid") },
            { label: t("form.confirm.documents"), value: t("form.confirm.documentCount", { count: documentCount }) },
          ].map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[200px_minmax(0,1fr)] gap-3 border-b px-4 py-2 last:border-b-0"
            >
              <dt className="text-[15px] text-muted-foreground">{row.label}</dt>
              <dd className="font-semibold break-words whitespace-pre-line">{row.value}</dd>
            </div>
          ))}
        </dl>
        {matches.length > 0 && <NicMatches matches={matches} />}
        <p className="text-[15px] text-[#3F4843]">{t("form.confirm.after")}</p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="h-12 rounded-lg border border-input px-6 text-[17px] font-semibold"
          >
            {t("form.confirm.back")}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              send();
            }}
            className="h-12 rounded-lg bg-primary px-7 text-[17px] font-bold text-primary-foreground"
          >
            {t("form.confirm.send")}
          </button>
        </div>
      </Modal>
    </div>
  );
}

/** One numbered part of the form, as in the prototype. */
function Part({
  number,
  id,
  title,
  children,
}: {
  number: number;
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      tabIndex={-1}
      className="flex flex-col gap-4 rounded-xl border bg-card px-6 py-5"
    >
      <h2 id={`${id}-title`} className="flex items-center gap-3 text-xl font-bold">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-base text-primary-foreground"
        >
          {number}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Large radio cards, with a hint when given, as in the prototype. */
function ChoiceCards({
  id,
  name,
  labelledBy,
  options,
  value,
  onChange,
  error,
}: {
  id?: string;
  name: string;
  labelledBy: string;
  options: { value: string; label: string; hint?: string }[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const errorId = `${name}-error`;
  return (
    <>
      <div
        id={id}
        tabIndex={id ? -1 : undefined}
        role="radiogroup"
        aria-labelledby={labelledBy}
        aria-describedby={error ? errorId : undefined}
        className="grid grid-cols-2 gap-3.5"
      >
        {options.map((option) => {
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-3.5 rounded-lg border-2 px-4.5 py-4 ${
                checked ? "border-primary bg-accent" : error ? "border-destructive" : "border-border bg-card"
              }`}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="mt-1 size-[22px] shrink-0 accent-primary"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-lg font-bold">{option.label}</span>
                {option.hint && <span className="text-[15px] text-muted-foreground">{option.hint}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <p id={errorId} className="text-[15px] font-medium text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

/** A short row of radio buttons under a label, such as yes or no. None is chosen to start with. */
function Radios({
  id,
  label,
  options,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span id={`${id}-label`} className="text-base font-semibold">
        {label}
      </span>
      <div
        id={id}
        tabIndex={-1}
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        aria-describedby={error ? `${id}-error` : undefined}
        className="flex flex-wrap gap-x-7 gap-y-2"
      >
        {options.map((option) => (
          <label key={option.value} className="flex cursor-pointer items-center gap-2.5 text-[17px]">
            <input
              type="radio"
              name={id}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="size-[22px] shrink-0 accent-primary"
            />
            {option.label}
          </label>
        ))}
      </div>
      {error && (
        <p id={`${id}-error`} className="text-[15px] font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** The date of birth, with the age worked out from it beside the field (CASE-14, CASE-15). */
function BirthDate({
  label,
  age,
  value,
  today,
  onChange,
  error,
}: {
  label: string;
  age: string | null;
  value: string;
  today: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  error?: string;
}) {
  return (
    <div className="flex items-end gap-4">
      <div className="min-w-0 flex-1">
        <FormField
          id="dateOfBirth"
          type="date"
          max={today}
          label={label}
          value={value}
          onChange={onChange}
          error={error}
        />
      </div>
      {age && (
        <p data-testid="age" className={`pb-3 text-[17px] font-semibold ${error ? "self-center" : ""}`}>
          {age}
        </p>
      )}
    </div>
  );
}

/**
 * One child development centre (CASE-14): its name, its province, and "from" and "until", each a year, a
 * month and a day, of which only the year is needed. The month waits for the year, the day for the month.
 */
function CentreBox({
  index,
  value,
  provinces,
  errorText,
  onChange,
  onRemove,
}: {
  index: number;
  value: CentreFormValues;
  provinces: { id: number; name: string }[];
  errorText: (part: CentrePart) => string | undefined;
  onChange: (value: CentreFormValues) => void;
  onRemove: (() => void) | null;
}) {
  const t = useTranslations("cases");
  const id = (field: string) => `centre-${index}-${field}`;
  const update = (changes: Partial<CentreFormValues>) => onChange({ ...value, ...changes });

  const datePart = (which: "from" | "until") => {
    const year = which === "from" ? "fromYear" : "untilYear";
    const month = which === "from" ? "fromMonth" : "untilMonth";
    const day = which === "from" ? "fromDay" : "untilDay";
    const error = errorText(which);
    return (
      <fieldset
        aria-describedby={[which === "until" ? id("until-help") : "", error ? id(`${which}-error`) : ""]
          .filter(Boolean)
          .join(" ")}
        className="flex flex-col gap-1.5"
      >
        <legend className="text-base font-semibold">{t(`form.${which}`)}</legend>
        <div className="grid grid-cols-[6rem_minmax(0,1fr)_5rem] gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={id(year)} className="text-sm text-muted-foreground">
              {t("form.year")}
            </label>
            <input
              id={id(year)}
              inputMode="numeric"
              maxLength={4}
              value={value[year]}
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                const next = event.target.value;
                update(next.trim() === "" ? { [year]: "", [month]: "", [day]: "" } : { [year]: next });
              }}
              className="h-12 rounded-lg border border-input bg-card px-3 text-[17px] aria-invalid:border-destructive"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={id(month)} className="text-sm text-muted-foreground">
              {t("form.month")}
            </label>
            <select
              id={id(month)}
              value={value[month]}
              disabled={value[year].trim() === ""}
              onChange={(event) =>
                update(event.target.value === "" ? { [month]: "", [day]: "" } : { [month]: event.target.value })
              }
              className="h-12 rounded-lg border border-input bg-card px-2 text-[17px] disabled:opacity-60"
            >
              <option value="" />
              {MONTHS.map((m) => (
                <option key={m} value={String(m)}>
                  {t(`month.${m}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={id(day)} className="text-sm text-muted-foreground">
              {t("form.day")}
            </label>
            <select
              id={id(day)}
              value={value[day]}
              disabled={value[month] === ""}
              onChange={(event) => update({ [day]: event.target.value })}
              className="h-12 rounded-lg border border-input bg-card px-2 text-[17px] disabled:opacity-60"
            >
              <option value="" />
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>
        {which === "until" && (
          <span id={id("until-help")} className="text-sm text-muted-foreground">
            {t("form.untilHelp")}
          </span>
        )}
        {error && (
          <p id={id(`${which}-error`)} className="text-[15px] font-medium text-destructive">
            {error}
          </p>
        )}
      </fieldset>
    );
  };

  return (
    <section
      aria-labelledby={id("title")}
      data-testid="centre"
      className="flex flex-col gap-4 rounded-lg border bg-muted/40 p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h4 id={id("title")} className="font-bold">
          {t("form.centre", { number: index + 1 })}
        </h4>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={t("form.removeCentre", { number: index + 1 })}
            className="text-[15px] font-semibold text-destructive underline"
          >
            {t("form.remove")}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-5">
        <FormField
          id={id("name")}
          label={t("form.centreName")}
          value={value.name}
          onChange={(event) => update({ name: event.target.value })}
          error={errorText("name")}
        />
        <Select
          id={id("provinceId")}
          label={t("form.centreProvince")}
          value={value.provinceId}
          onChange={(provinceId) => update({ provinceId })}
          placeholder={t("form.choose")}
          options={provinces.map((p) => ({ value: String(p.id), label: p.name }))}
          error={errorText("provinceId")}
        />
      </div>
      <div className="grid grid-cols-2 gap-5">
        {datePart("from")}
        {datePart("until")}
      </div>
    </section>
  );
}

function Select({
  id,
  label,
  value,
  onChange,
  placeholder,
  options,
  disabled,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-base font-semibold">
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="h-12 rounded-lg border border-input bg-card px-3 text-[17px] disabled:opacity-60 aria-invalid:border-destructive"
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && (
        <p id={`${id}-error`} className="text-[15px] font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
