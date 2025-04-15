+++
SequenceNumber = {{ SequenceNumber }}
Anchor = "{{ PersonId }}"
Title = "{{ FullName }}"
Image =  {%- if HeadShotFilename %} "headshots/{{ HeadShotFilename }}" {%- else %} "None" {% endif %}
Tags = [
{%- if CoordinatorRole %} "coordinator", {% endif -%}
{%- if AdvisorRole %} "advisor", {% endif -%}
{%- if CoInvestigatorRole %} "co-investigator", {% endif -%}
{%- if LeadRole %} "study_lead", {% endif -%} 
{%- if SpinOffRole %} "spin-off", {% endif -%} 
]
ScholarUrl = "{{ ScholarUrl }}"
UniUrl = "{{ UniUrl }}"
LabUrl = "{{ LabUrl }}"
StudyId = "{{ StudyId }}"
PersonId = "{{ PersonId }}"
FullName = "{{ FullName }}"
Affiliation = "{{ Affiliation }}"
+++