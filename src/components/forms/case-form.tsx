"use client";

import { useTranslations } from "next-intl";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { FormError, FormField, FormTextArea } from "@/components/forms/form-field";
import { Modal } from "@/components/modal";
import { isValidNic, normaliseNic } from "@/lib/nic";
import {
  CASE_FIELDS,
  CATEGORIES,
  type CaseErrors,
  type CaseField,
  FORM_KINDS,
  KINDS,
  parseCaseForm,
  parseOfficeId,
} from "@/lib/validation/case";
import type { CaseCommandError } from "@/server/cases/commands";
import type { NicMatch } from "@/server/cases/duplicates";
import type { DistrictOptions } from "@/server/lists/queries";
import { CaseDocuments, type DocumentActions, type Upload } from "./case-documents";
import { NicMatches } from "./nic-matches";

export type CaseFormValues = Record<CaseField, string>;
export type CaseFormState = { errors: CaseErrors; error: CaseCommandError | null };

/** Where the beneficiary lives: the DS office of residence, which enters the case (CASE-3). */
export type OfficeSetting =
  /** A DS officer's own office, from their account. */
  | { kind: "own"; dsOfficeId: number; districtName: string; officeName: string }
  /** The Ministry, once the case is allocated: the office stays. */
  | { kind: "fixed"; dsOfficeId: number; districtName: string; officeName: string }
  /** The Ministry chooses the district, then the DS office. */
  | { kind: "choose"; districts: DistrictOptions[]; districtId: number | null; dsOfficeId: number | null };

/** CASE-13: where the house is built or the land bought. */
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

const EMPTY: CaseFormState = { errors: {}, error: null };
const DETAIL_FIELDS: CaseField[] = [
  "applicationNumber",
  "childName",
  "name",
  "nic",
  "address",
  "gnDivision",
  "mobile1",
  "mobile2",
  "remark",
];

/**
 * CASE-1: the case form on one page, in four numbered parts, as in the prototype. Everything typed is
 * kept in state, so a refused save loses nothing (ERR-1, ERR-3). The browser runs the same checks as the
 * server before anything is sent. There are no drafts: every save needs every required field, and a new
 * case shows a summary to confirm first, then goes straight to "awaiting fund allocation" (CASE-5).
 * The kind of help is followed by where the house is built (CASE-13); the Application Number opens the
 * beneficiary's details (CASE-12). A saved case is changed with one save button (CASE-9); `intro` says
 * that every change is logged, for the Ministry's changes after the allocation.
 */
export function CaseForm({
  caseId,
  version,
  initial,
  office,
  build,
  documents,
  actions,
  mode,
  intro = false,
}: {
  caseId: string;
  /** The version the form was opened with (CASE-10); null for a new case. */
  version: number | null;
  initial: CaseFormValues;
  office: OfficeSetting;
  build: BuildSetting;
  documents: { id: string; name: string }[];
  actions: CaseFormActions;
  mode: "new" | "edit";
  intro?: boolean;
}) {
  const t = useTranslations("cases");
  const [state, dispatch, pending] = useActionState(actions.save, EMPTY);
  const [, startTransition] = useTransition();
  const [values, setValues] = useState(initial);
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

  const category = CATEGORIES.find((c) => c === values.category);
  const kind = KINDS.find((k) => k === values.kind);
  const atRisk = category === "CHILD_AT_RISK";
  const errors = localErrors ?? state.errors;
  const serverError = localErrors === null ? state.error : null;
  const showOfficeError = officeMissing || serverError === "officeRequired";
  const showBuildError = buildMissing || serverError === "buildOfficeRequired";
  const uploading = uploads.some((u) => u.state === "uploading");
  const documentCount = documents.length + uploads.filter((u) => u.state === "done").length;
  const chosenOffice = office.kind === "choose" ? parseOfficeId(dsOfficeId) : null;
  // The DS of residence, which "the same DS division" means and the build office can't be (CASE-13).
  const residence = office.kind === "choose" ? chosenOffice : office.dsOfficeId;
  const chosenBuildOffice = build.kind === "choose" && built === "other" ? parseOfficeId(buildOfficeId) : null;

  const set = (field: CaseField) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  const fieldLabel = (field: CaseField) =>
    field === "name" && atRisk ? t("page.fields.guardianName") : t(`page.fields.${field}`);
  const errorText = (field: CaseField) => {
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
    const checked = parseCaseForm((field) => values[field]);
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
    const target = field === "category" || field === "kind" ? `part-${field}` : field;
    return [{ key: field, target, message }];
  };
  const errorList = [
    ...fieldError("category"),
    ...fieldError("kind"),
    ...(showBuildError
      ? [{ key: "built", target: "buildDsOfficeId", message: t("form.errors.buildOfficeRequired") }]
      : []),
    ...CASE_FIELDS.filter((field) => field !== "category" && field !== "kind").flatMap(fieldError),
    ...(showOfficeError ? [{ key: "office", target: "dsOfficeId", message: t("form.errors.officeRequired") }] : []),
  ];

  const complete = parseCaseForm((field) => values[field]);
  const incomplete: CaseErrors = complete.ok ? {} : complete.errors;
  const officeChosen = office.kind !== "choose" || chosenOffice !== null;
  const buildChosen = build.kind !== "choose" || built === "same" || chosenBuildOffice !== null;
  const parts = [
    { key: "category", done: !incomplete.category, optional: false },
    { key: "kind", done: !incomplete.kind && buildChosen, optional: false },
    { key: "details", done: DETAIL_FIELDS.every((f) => !incomplete[f]) && officeChosen, optional: false },
    { key: "documents", done: documentCount > 0, optional: true },
  ] as const;

  const district = office.kind === "choose" ? office.districts.find((d) => String(d.id) === districtId) : undefined;
  const officeName =
    office.kind === "choose"
      ? (district?.offices.find((o) => String(o.id) === dsOfficeId)?.name ?? "")
      : office.officeName;
  const buildDistrict =
    build.kind === "choose" ? build.districts.find((d) => String(d.id) === buildDistrictId) : undefined;
  const buildOfficeName = buildDistrict?.offices.find((o) => String(o.id) === buildOfficeId)?.name ?? "";
  const busy = pending || uploading;

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
            onChange={(value) => setValues((v) => ({ ...v, category: value }))}
            error={errorText("category")}
          />
        </Part>

        <Part number={2} id="part-kind" title={t("form.partKind")}>
          <ChoiceCards
            name="kind"
            labelledBy="part-kind-title"
            options={FORM_KINDS.map((value) => ({ value, label: t(`kind.${value}`), hint: t(`kindHint.${value}`) }))}
            value={values.kind}
            onChange={(value) => setValues((v) => ({ ...v, kind: value }))}
            error={errorText("kind")}
          />
          <div className="flex flex-col gap-3 border-t pt-4">
            <h3 id="built-title" className="text-lg font-bold">
              {t("form.built.title")}
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
              </>
            ) : (
              <p className="rounded-lg bg-muted px-4 py-3 text-[15px] text-[#3F4843]">
                {build.dsOfficeId === null
                  ? t("form.built.fixedSame")
                  : t("form.built.fixed", { district: build.districtName, office: build.officeName })}
              </p>
            )}
          </div>
        </Part>

        <Part number={3} id="part-details" title={t("form.partDetails")}>
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
          <FormTextArea
            id="remark"
            label={t("form.remark")}
            value={values.remark}
            onChange={set("remark")}
            error={errorText("remark")}
          />

          {office.kind === "choose" ? (
            <div className="grid grid-cols-2 gap-5 rounded-lg bg-muted p-4">
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
          ) : (
            <p className="rounded-lg bg-muted px-4 py-3 text-[15px] text-[#3F4843]">
              {t(office.kind === "own" ? "form.officeAuto" : "form.officeFixed", {
                district: office.districtName,
                office: office.officeName,
              })}
            </p>
          )}
        </Part>

        <Part number={4} id="part-documents" title={t("form.partDocuments")}>
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
        <dl className="flex flex-col overflow-hidden rounded-lg border">
          {[
            { label: t("form.confirm.category"), value: category ? t(`category.${category}`) : "" },
            { label: t("form.confirm.kind"), value: kind ? t(`kind.${kind}`) : "" },
            {
              label: t("form.confirm.built"),
              value: built === "same" ? t("form.built.same") : buildOfficeName,
            },
            { label: t("form.confirm.applicationNumber"), value: values.applicationNumber.trim() },
            ...(atRisk ? [{ label: t("form.confirm.childName"), value: values.childName }] : []),
            { label: atRisk ? t("form.confirm.guardianName") : t("form.confirm.name"), value: values.name },
            { label: t("form.confirm.nic"), value: normaliseNic(values.nic) },
            { label: t("form.confirm.address"), value: values.address },
            { label: t("form.confirm.gnDivision"), value: values.gnDivision },
            {
              label: t("form.confirm.phones"),
              value: [values.mobile1, values.mobile2].filter((p) => p.trim() !== "").join(", "),
            },
            { label: t("form.confirm.office"), value: officeName },
            { label: t("form.confirm.documents"), value: t("form.confirm.documentCount", { count: documentCount }) },
          ].map((row) => (
            <div
              key={row.label}
              className="grid grid-cols-[200px_minmax(0,1fr)] gap-3 border-b px-4 py-2 last:border-b-0"
            >
              <dt className="text-[15px] text-muted-foreground">{row.label}</dt>
              <dd className="font-semibold break-words">{row.value}</dd>
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

/** Large radio cards with a hint, as in the prototype. */
function ChoiceCards({
  name,
  labelledBy,
  options,
  value,
  onChange,
  error,
}: {
  name: string;
  labelledBy: string;
  options: { value: string; label: string; hint: string }[];
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const errorId = `${name}-error`;
  return (
    <>
      <div
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
                <span className="text-[15px] text-muted-foreground">{option.hint}</span>
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
