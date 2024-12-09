+++
SequenceNumber = "{{ SequenceNumber }}"
Anchor = "{{ StudyId }}"
Title = "{{ Title|truncate(60, True) }}"
Image = "figures/{{ StudyId }}.png"
StudyId = "{{ StudyId }}"
LeadFullName = "{{ LeadFullName }}"
PersonId = "{{ PersonId }}"
Reference = "{{ Reference }}"
PsychConstruct = "{{ PsychConstruct }}"
SignupUrl = "{{ SignupUrl }}"
Tags = ["{{ StageName|title }}", "{{ Theme }}"]
DOI = "{{ Doi }}"
DoiUrl = "https://dx.doi.org/{{ Doi }}"
PublicationId = "{{ PublicationId }}"
+++

Lead by [{{ LeadFullName }}](/people/#{{ PersonId }})

{{ Abstract|truncate(200, True) }}