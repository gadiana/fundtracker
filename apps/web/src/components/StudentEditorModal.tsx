import { useState } from 'react';
import { api, ApiError, describeError } from '../lib/api';
import type { Student, StudentMeta } from '../lib/types';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';
import {
  DuplicateReview,
  duplicateChoiceReady,
  duplicateFromError,
  EMPTY_STUDENT,
  StudentFields,
  studentFormReady,
  studentPayload,
  type DuplicateChoice,
  type DuplicateState,
  type StudentFormValues,
} from './StudentForm';
import { Button } from './ui';

const LABELS = { studentNumber: 'Student number', firstName: 'First name', lastName: 'Last name', programId: 'Program', email: 'Email' };

export function toFormValues(s: Student): StudentFormValues {
  return {
    studentNumber: s.studentNumber,
    firstName: s.firstName,
    middleName: s.middleName ?? '',
    lastName: s.lastName,
    suffix: s.suffix ?? '',
    programId: s.program.id,
    yearLevel: s.yearLevel,
    sectionId: s.section?.id ?? '',
    email: s.email ?? '',
    contactNo: s.contactNo ?? '',
  };
}

/** Add a student, or edit one (pass `student`). */
export function StudentEditorModal({
  meta,
  student,
  onClose,
  onSaved,
}: {
  meta: StudentMeta;
  student?: Student;
  onClose: () => void;
  onSaved: (s: Student) => void;
}) {
  const [values, setValues] = useState<StudentFormValues>(() => (student ? toFormValues(student) : EMPTY_STUDENT));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicate, setDuplicate] = useState<DuplicateState | null>(null);
  const [choice, setChoice] = useState<DuplicateChoice>({ acknowledgeSimilar: false, reason: '' });
  const [confirming, setConfirming] = useState(false);

  const change = (v: StudentFormValues) => {
    setValues(v);
    // a different name or number needs a fresh duplicate check
    if (duplicate && (v.studentNumber !== values.studentNumber || v.firstName !== values.firstName || v.lastName !== values.lastName || v.middleName !== values.middleName)) {
      setDuplicate(null);
      setChoice({ acknowledgeSimilar: false, reason: '' });
    }
  };

  async function save() {
    const body = {
      ...studentPayload(values),
      acknowledgeSimilar: choice.acknowledgeSimilar || undefined,
      duplicateOverrideReason: choice.reason.trim() || undefined,
    };
    try {
      const saved = student
        ? await api<Student>(`/students/${student.id}`, { method: 'PATCH', body })
        : await api<Student>('/students', { method: 'POST', body });
      onSaved(saved);
    } catch (err) {
      const dup = duplicateFromError(err);
      if (dup) {
        setDuplicate(dup);
        throw new Error('Possible duplicate. Review it in the form, then save again.');
      }
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      throw new Error(describeError(err, LABELS));
    }
  }

  const ready = studentFormReady(values) && duplicateChoiceReady(duplicate, choice);
  const title = student ? `Edit ${student.name}` : 'Add a student';

  return (
    <>
      <Modal
        open
        title={title}
        subtitle={student ? undefined : 'Added students are active right away. Staff and the adviser can add students.'}
        onClose={onClose}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => setConfirming(true)} disabled={!ready}>
              {student ? 'Save changes' : 'Add student'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <StudentFields values={values} onChange={change} meta={meta} errors={errors} />
          {duplicate && <DuplicateReview state={duplicate} choice={choice} onChange={setChoice} />}
        </div>
      </Modal>
      <ConfirmDialog
        open={confirming}
        title={student ? 'Save changes to this student?' : `Add ${values.firstName} ${values.lastName}?`}
        description={student ? 'Past payments and receipts keep the details they were made with.' : `Student number ${values.studentNumber.toUpperCase()}.`}
        confirmLabel={student ? 'Save' : 'Add student'}
        onConfirm={save}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
